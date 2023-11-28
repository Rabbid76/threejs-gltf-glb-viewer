import type { GBufferTextures } from './gbuffer-render-target';
import { GBufferRenderTargets } from './gbuffer-render-target';
import {
  CopyMaterialBlendMode,
  CopyTransformMaterial,
  DEFAULT_TRANSFORM,
  interpolationMatrix,
} from './shader-utility';
import type { DenoisePass, SceneVolume } from './render-utility';
import {
  NormalVectorSourceType,
  DepthValueSourceType,
} from './pass/pass-utility';
import {
  CameraUpdate,
  generateMagicSquareDistributedKernelRotations,
  RenderPass,
  spiralQuadraticSampleKernel,
} from './render-utility';
import type { HBAORenderPassParameters } from './pass/hbao-pass';
import {
  defaultHBAORenderPassParameters,
  HBAORenderPass,
} from './pass/hbao-pass';
import type { PoissonDenoisePassParameters } from './pass/poisson-denoise-pass';
import {
  defaultPoissonDenoisePassParameters,
  PoissonDenoiseRenderPass,
} from './pass/poisson-denoise-pass';
import type {
  Camera,
  DataTexture,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three';
import {
  CustomBlending,
  LinearFilter,
  Matrix4,
  NoBlending,
  RGFormat,
  ShaderMaterial,
  UniformsUtils,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';

export enum ShadowBlurType {
  OFF,
  HARD,
  POISSON,
  FULL,
}

export enum AmbientOcclusionType {
  NONE,
  SSAO,
  HBAO,
}

export interface ShadowAndAoParameters {
  [key: string]: any;
  aoKernelRadius: number;
  aoDepthBias: number;
  aoMaxDistance: number;
  aoMaxDepth: number;
  aoFadeout: number;
  shadowRadius: number;
}

export interface ShadowAndAoPassParameters {
  enabled: boolean;
  aoType: AmbientOcclusionType;
  aoIntensity: number;
  shadowIntensity: number;
  aoOnGround: boolean;
  shadowOnGround: boolean;
  alwaysUpdate: boolean;
  progressiveDenoiseIterations: number;
  shAndAo: ShadowAndAoParameters;
  hbao: HBAORenderPassParameters;
  poissonDenoise: PoissonDenoisePassParameters;
}

export const defaultShadowAndAoParameters: ShadowAndAoParameters = {
  aoKernelRadius: 0.25, //0.05,
  aoDepthBias: 0.0001,
  aoMaxDistance: 0.5, //0.1,
  aoMaxDepth: 0.99,
  aoFadeout: 0.5, //1,
  shadowRadius: 0.05,
};

export const defaultPassParameters = {
  enabled: true,
  aoType: AmbientOcclusionType.SSAO,
  aoIntensity: 0.5,
  shadowIntensity: 0.35,
  aoOnGround: true,
  shadowOnGround: false,
  alwaysUpdate: false,
  progressiveDenoiseIterations: 0,
};

export interface ShadowAndAoPassConstructorParameters {
  gBufferRenderTarget?: GBufferRenderTargets;
  renderPass?: RenderPass;
  enabled?: boolean;
  aoType?: AmbientOcclusionType;
  aoIntensity?: number;
  shadowIntensity?: number;
  aoOnGround?: boolean;
  shadowOnGround?: boolean;
  alwaysUpdate?: boolean;
  progressiveDenoiseIterations?: number;
  shAndAo?: ShadowAndAoParameters;
  hbao?: HBAORenderPassParameters;
  poissonDenoise?: PoissonDenoisePassParameters;
}

export class ShadowAndAoPass {
  // prettier-ignore
  public static shadowTransform: Matrix4 = new Matrix4().set(
    0, 1, 0, 0,
    0, 1, 0, 0,
    0, 1, 0, 0,
    0, 0, 0, 1
  );
  public parameters: ShadowAndAoPassParameters;
  public needsUpdate: boolean = true;
  private _width: number;
  private _height: number;
  private _samples: number;
  private _renderPass: RenderPass = new RenderPass();
  private _sharedGBufferRenderTarget?: GBufferRenderTargets;
  private _gBufferRenderTarget?: GBufferRenderTargets;
  public shadowAndAoRenderTargets: ShadowAndAoRenderTargets;
  private _hbaoPass?: HBAORenderPass;
  private _fadeRenderTarget?: WebGLRenderTarget;
  private _poissonDenoisePass?: PoissonDenoiseRenderPass;
  private _copyMaterial: CopyTransformMaterial;
  private _blendMaterial: CopyTransformMaterial;
  private _cameraUpdate: CameraUpdate = new CameraUpdate();

  public get gBufferRenderTarget(): GBufferRenderTargets {
    if (this._sharedGBufferRenderTarget) {
      return this._sharedGBufferRenderTarget;
    }
    this._gBufferRenderTarget =
      this._gBufferRenderTarget ??
      new GBufferRenderTargets(undefined, {
        width: this._width,
        height: this._height,
        samples: this._samples,
        renderPass: this._renderPass,
      });
    return this._gBufferRenderTarget;
  }

  public get hbaoRenderPass(): HBAORenderPass {
    if (!this._hbaoPass) {
      this._hbaoPass = new HBAORenderPass(this._width, this._height, {
        normalVectorSourceType: this.gBufferRenderTarget
          .isFloatGBufferWithRgbNormalAlphaDepth
          ? NormalVectorSourceType.FLOAT_BUFFER_NORMAL
          : NormalVectorSourceType.INPUT_RGB_NORMAL,
        depthValueSourceType: this.gBufferRenderTarget
          .isFloatGBufferWithRgbNormalAlphaDepth
          ? DepthValueSourceType.NORMAL_VECTOR_ALPHA
          : DepthValueSourceType.SEPARATE_BUFFER,
        modulateRedChannel: true,
        hbaoParameters: this.parameters.hbao,
      });
    }
    return this._hbaoPass;
  }

  public get fadeRenderTarget(): WebGLRenderTarget {
    this._fadeRenderTarget =
      this._fadeRenderTarget ??
      new WebGLRenderTarget(this._width, this._height, {
        format: RGFormat,
        magFilter: LinearFilter,
        minFilter: LinearFilter,
      });
    return this._fadeRenderTarget;
  }

  public get denoisePass(): DenoisePass {
    if (!this._poissonDenoisePass) {
      this._poissonDenoisePass = new PoissonDenoiseRenderPass(
        this._width,
        this._height,
        {
          inputTexture: this.shadowAndAoRenderTargets.passRenderTarget.texture,
          depthTexture: this.gBufferRenderTarget.depthBufferTexture,
          normalTexture: this.gBufferRenderTarget.gBufferTexture,
          normalVectorSourceType: this.gBufferRenderTarget
            .isFloatGBufferWithRgbNormalAlphaDepth
            ? NormalVectorSourceType.FLOAT_BUFFER_NORMAL
            : NormalVectorSourceType.INPUT_RGB_NORMAL,
          depthValueSourceType: this.gBufferRenderTarget
            .isFloatGBufferWithRgbNormalAlphaDepth
            ? DepthValueSourceType.NORMAL_VECTOR_ALPHA
            : DepthValueSourceType.SEPARATE_BUFFER,
          rgInputTexture: true,
          poissonDenoisePassParameters: this.parameters.poissonDenoise,
        }
      );
    } else {
      const denoisePass = this._poissonDenoisePass as PoissonDenoiseRenderPass;
      denoisePass.depthTexture = this.gBufferRenderTarget.depthBufferTexture;
      denoisePass.normalTexture = this.gBufferRenderTarget.gBufferTexture;
    }
    return this._poissonDenoisePass;
  }

  public get denoiseRenderTargetTexture(): Texture | null {
    return this.denoisePass ? this.denoisePass.texture : null;
  }

  constructor(
    width: number,
    height: number,
    samples: number,
    parameters?: ShadowAndAoPassConstructorParameters
  ) {
    if (parameters?.gBufferRenderTarget) {
      this._sharedGBufferRenderTarget = parameters?.gBufferRenderTarget;
    }
    this._width = width;
    this._height = height;
    this._samples = samples;
    this._renderPass = parameters?.renderPass ?? new RenderPass();
    this.shadowAndAoRenderTargets = new ShadowAndAoRenderTargets(
      this.gBufferRenderTarget,
      { ...parameters, width, height, samples, renderPass: this._renderPass }
    );
    this.parameters = {
      enabled: parameters?.enabled ?? defaultPassParameters.enabled,
      aoType: parameters?.aoType ?? defaultPassParameters.aoType,
      aoIntensity: parameters?.aoIntensity ?? defaultPassParameters.aoIntensity,
      shadowIntensity:
        parameters?.shadowIntensity ?? defaultPassParameters.shadowIntensity,
      aoOnGround: parameters?.aoOnGround ?? defaultPassParameters.aoOnGround,
      shadowOnGround:
        parameters?.shadowOnGround ?? defaultPassParameters.shadowOnGround,
      alwaysUpdate:
        parameters?.alwaysUpdate ?? defaultPassParameters.alwaysUpdate,
      progressiveDenoiseIterations:
        parameters?.progressiveDenoiseIterations ??
        defaultPassParameters.progressiveDenoiseIterations,
      shAndAo: this.shadowAndAoRenderTargets.shadowAndAoParameters,
      hbao: {
        ...defaultHBAORenderPassParameters,
      },
      poissonDenoise: {
        ...defaultPoissonDenoisePassParameters,
      },
    };
    this._copyMaterial = new CopyTransformMaterial();
    this._blendMaterial = new CopyTransformMaterial(
      {},
      CopyMaterialBlendMode.DEFAULT
    );
  }

  public dispose() {
    this._gBufferRenderTarget?.dispose();
    this.shadowAndAoRenderTargets.dispose();
    this._hbaoPass?.dispose();
    this._fadeRenderTarget?.dispose();
    this._poissonDenoisePass?.dispose();
    this._copyMaterial?.dispose();
    this._blendMaterial?.dispose();
  }

  public setSize(width: number, height: number) {
    this._width = width;
    this._height = height;
    this._gBufferRenderTarget?.setSize(width, height);
    this.shadowAndAoRenderTargets.setSize(width, height);
    this._hbaoPass?.setSize(width, height);
    this._fadeRenderTarget?.setSize(width, height);
    this._poissonDenoisePass?.setSize(this._width, this._height);
    this.needsUpdate = true;
  }

  public updateParameters(parameters: ShadowAndAoPassParameters) {
    if (parameters.enabled !== undefined) {
      this.parameters.enabled = parameters.enabled;
    }
    if (parameters.aoType !== undefined) {
      this.parameters.aoType = parameters.aoType;
    }
    if (parameters.aoIntensity !== undefined) {
      this.parameters.aoIntensity = parameters.aoIntensity;
    }
    if (parameters.shadowIntensity !== undefined) {
      this.parameters.shadowIntensity = parameters.shadowIntensity;
    }
    if (parameters.aoOnGround !== undefined) {
      this.parameters.aoOnGround = parameters.aoOnGround;
    }
    if (parameters.shadowOnGround !== undefined) {
      this.parameters.shadowOnGround = parameters.shadowOnGround;
    }
    if (parameters.alwaysUpdate !== undefined) {
      this.parameters.alwaysUpdate = parameters.alwaysUpdate;
    }
    this._updatePassParameters(parameters);
  }

  private _updatePassParameters(parameters: ShadowAndAoPassParameters) {
    if (parameters?.shAndAo) {
      for (let propertyName in parameters.shAndAo) {
        if (this.parameters.shAndAo.hasOwnProperty(propertyName)) {
          this.parameters.shAndAo[propertyName] =
            parameters.shAndAo[propertyName];
          this.shadowAndAoRenderTargets.parametersNeedsUpdate = true;
        }
      }
    }
    if (parameters?.hbao) {
      if (this._hbaoPass) {
        this._hbaoPass?.updateParameters(parameters?.hbao);
      } else {
        for (let propertyName in parameters.hbao) {
          if (this.parameters.hbao.hasOwnProperty(propertyName)) {
            this.parameters.hbao[propertyName] = parameters.hbao[propertyName];
          }
        }
      }
    }
    if (parameters?.poissonDenoise) {
      if (this._poissonDenoisePass) {
        this._poissonDenoisePass?.updateParameters(parameters?.poissonDenoise);
      } else {
        for (let propertyName in parameters.poissonDenoise) {
          if (this.parameters.poissonDenoise.hasOwnProperty(propertyName)) {
            this.parameters.poissonDenoise[propertyName] =
              parameters.poissonDenoise[propertyName];
          }
        }
      }
    }
  }

  public updateBounds(sceneBounds: SceneVolume, _shadowAndAoScale: number) {
    this.shadowAndAoRenderTargets.updateBounds(sceneBounds, _shadowAndAoScale);
  }

  private _getRenderConditions(
    shadowFadeInBlurType: ShadowBlurType = ShadowBlurType.FULL,
    shadowFadeInMix: number = 0,
    noOStaticFrames: number = 0
  ) {
    const fadeInPoissonShadow =
      shadowFadeInBlurType === ShadowBlurType.POISSON &&
      shadowFadeInMix > 0.001;
    const fadeInHardShadow =
      shadowFadeInBlurType === ShadowBlurType.HARD &&
      shadowFadeInMix > 0.001 &&
      shadowFadeInMix < 0.999;
    const onlyHardShadow =
      shadowFadeInBlurType === ShadowBlurType.HARD && !fadeInHardShadow;
    const progressiveDenoise =
      !fadeInPoissonShadow &&
      !fadeInHardShadow &&
      noOStaticFrames > 1 &&
      noOStaticFrames <= this.parameters.progressiveDenoiseIterations + 1;
    return {
      fadeInPoissonShadow,
      fadeInHardShadow,
      onlyHardShadow,
      progressiveDenoise,
    };
  }

  public render(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    shadowMapTexture: Texture,
    shadowBlurType: ShadowBlurType = ShadowBlurType.FULL,
    shadowFadeInBlurType: ShadowBlurType = ShadowBlurType.FULL,
    shadowFadeInMix: number = 0,
    noOStaticFrames: number = 0
  ): void {
    if (!this._setRenderState()) {
      return;
    }
    const renderConditions = this._getRenderConditions(
      shadowFadeInBlurType,
      shadowFadeInMix,
      noOStaticFrames
    );
    let needsDenoise = false;
    if (
      !renderConditions.onlyHardShadow &&
      shadowBlurType === ShadowBlurType.FULL &&
      this._evaluateIfUpdateIsNeeded(camera)
    ) {
      this._renderShadowAndAo(renderer, scene, camera, shadowMapTexture);
      needsDenoise = true;
    }
    let finalTexture: Texture | null = renderConditions.onlyHardShadow
      ? shadowMapTexture
      : this.denoiseRenderTargetTexture;
    if (renderConditions.fadeInPoissonShadow) {
      finalTexture = this._renderDynamicShadow(
        renderer,
        this.shadowAndAoRenderTargets.passRenderTarget.texture,
        shadowMapTexture,
        shadowFadeInMix
      );
      needsDenoise = true;
    }
    if (needsDenoise) {
      finalTexture = this._renderDenoise(
        renderer,
        camera,
        renderConditions.fadeInPoissonShadow,
        false
      );
    } else if (renderConditions.progressiveDenoise) {
      finalTexture = this._renderDenoise(renderer, camera, false, true);
    }
    if (renderConditions.fadeInHardShadow) {
      finalTexture = this._renderDynamicShadow(
        renderer,
        this.denoiseRenderTargetTexture,
        shadowMapTexture,
        shadowFadeInMix
      );
    }
    this._renderToTarget(
      renderer,
      finalTexture,
      renderConditions.onlyHardShadow
    );
  }

  private _setRenderState(): boolean {
    this.shadowAndAoRenderTargets.aoEnabled =
      this.parameters.aoType === AmbientOcclusionType.SSAO;
    this.shadowAndAoRenderTargets.shadowEnabled =
      this.parameters.shadowIntensity > 0.01;
    if (
      !this.parameters.enabled ||
      !(
        this.parameters.aoType !== AmbientOcclusionType.NONE ||
        this.shadowAndAoRenderTargets.shadowEnabled
      )
    ) {
      return false;
    }
    if (this.needsUpdate) {
      if (this._hbaoPass) {
        this._hbaoPass.needsUpdate = true;
      }
      if (this._poissonDenoisePass) {
        this._poissonDenoisePass.needsUpdate = true;
      }
    }
    return true;
  }

  private _evaluateIfUpdateIsNeeded(camera: Camera): boolean {
    (camera as OrthographicCamera | PerspectiveCamera).updateProjectionMatrix();
    const needsUpdate =
      this.parameters.alwaysUpdate ||
      this.needsUpdate ||
      (camera != null && this._cameraUpdate.changed(camera));
    this.needsUpdate = false;
    return needsUpdate;
  }

  private _renderShadowAndAo(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    shadowMapTexture: Texture
  ): void {
    this.gBufferRenderTarget.render(renderer, scene, camera);
    this.shadowAndAoRenderTargets.render(renderer, camera, shadowMapTexture);
    this._renderAoEffect(renderer, scene, camera);
  }

  private _renderAoEffect(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera
  ): void {
    if (this.parameters.aoType !== AmbientOcclusionType.HBAO) {
      return;
    }
    const depthTexture = this.gBufferRenderTarget.depthBufferTexture;
    const normalTexture = this.gBufferRenderTarget.gBufferTexture;
    const renderTarget = this.shadowAndAoRenderTargets.passRenderTarget;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const hbaoEffect = this.hbaoRenderPass;
    hbaoEffect.depthTexture = depthTexture;
    hbaoEffect.normalTexture = normalTexture;
    hbaoEffect.render(renderer, camera, scene, renderTarget);
    renderer.autoClear = autoClear;
  }

  private _renderDynamicShadow(
    renderer: WebGLRenderer,
    passTexture: Texture | null,
    shadowMapTexture: Texture | null,
    shadowFadeInMix: number = 1
  ): Texture {
    const fade = shadowFadeInMix < 0.999;
    if (fade) {
      this._copyMaterial.update({
        texture: passTexture,
        blending: NoBlending,
        colorTransform: DEFAULT_TRANSFORM,
        multiplyChannels: 0,
      });
      this._renderPass.renderScreenSpace(
        renderer,
        this._copyMaterial,
        this.fadeRenderTarget
      );
    }
    if (shadowFadeInMix > 0.001) {
      this._blendMaterial.update({
        texture: shadowMapTexture,
        blending: fade ? CustomBlending : NoBlending,
        // prettier-ignore
        colorTransform: new Matrix4().set(
          0, 0, 0, 1,
          1, 0, 0, 0,
          0, 0, 0, 1,
          0, 0, 0, fade ? shadowFadeInMix : 1,
        ),
        multiplyChannels: 0,
      });
      this._renderPass.renderScreenSpace(
        renderer,
        this._blendMaterial,
        this.fadeRenderTarget
      );
    }
    return this.fadeRenderTarget.texture;
  }

  private _renderDenoise(
    renderer: WebGLRenderer,
    camera: Camera,
    fadeInShadow: boolean,
    progressiveDenoise: boolean
  ): Texture | null {
    const denoisePass = this.denoisePass;
    denoisePass.inputTexture = fadeInShadow
      ? this.fadeRenderTarget.texture
      : progressiveDenoise
        ? denoisePass.texture
        : this.shadowAndAoRenderTargets.passRenderTarget.texture;
    denoisePass.render(renderer, camera);
    return denoisePass.texture;
  }

  private _renderToTarget(
    renderer: WebGLRenderer,
    finalTexture: Texture | null,
    onlyHardShadow: boolean
  ): void {
    const redChannel = onlyHardShadow
      ? this.parameters.shadowIntensity
      : this.parameters.aoIntensity;
    const greenChannel = onlyHardShadow ? 0 : this.parameters.shadowIntensity;
    this._renderPass.renderScreenSpace(
      renderer,
      this._copyMaterial.update({
        texture: finalTexture,
        blending: CustomBlending,
        colorTransform: interpolationMatrix(redChannel, greenChannel, 0, 1),
        multiplyChannels: 1,
      }),
      renderer.getRenderTarget()
    );
  }
}

export interface ShadowAndAoRenderTargetsParameters {
  width?: number;
  height?: number;
  samples?: number;
  renderPass?: RenderPass;
  shAndAo?: ShadowAndAoParameters;
}

export class ShadowAndAoRenderTargets {
  public shadowAndAoParameters: ShadowAndAoParameters;
  public parametersNeedsUpdate: boolean = true;
  public aoEnabled: boolean = true;
  public shadowEnabled: boolean = true;
  private _width: number;
  private _height: number;
  private _samples: number;
  private _sceneBoxMin: Vector3 = new Vector3(-1, -1, -1);
  private _sceneBoxMax: Vector3 = new Vector3(1, 1, 1);
  private _shadowAndAoScale: number = 1;
  private _aoTargetSamples: number = 0;
  private _depthAndNormalTextures: GBufferTextures;
  private _noiseTexture?: DataTexture;
  private _sampleKernel: Vector3[] = [];
  private _passRenderMaterial?: ShadowAndAoRenderMaterial;
  private _passRenderTarget?: WebGLRenderTarget;
  private _renderPass: RenderPass;

  public get passRenderTarget(): WebGLRenderTarget {
    this._passRenderTarget =
      this._passRenderTarget ??
      new WebGLRenderTarget(this._width, this._height, {
        samples: this._aoTargetSamples,
        format: RGFormat,
        magFilter: LinearFilter,
        minFilter: LinearFilter,
      });
    return this._passRenderTarget;
  }

  private get passRenderMaterial(): ShadowAndAoRenderMaterial {
    this._passRenderMaterial =
      this._passRenderMaterial ??
      new ShadowAndAoRenderMaterial({
        normalTexture: this._depthAndNormalTextures.gBufferTexture,
        depthTexture: this._depthAndNormalTextures.depthBufferTexture,
        noiseTexture: this.noiseTexture,
        sampleKernel: this.sampleKernel,
        floatGBufferRgbNormalAlphaDepth:
          this._depthAndNormalTextures.isFloatGBufferWithRgbNormalAlphaDepth,
      });
    return this._passRenderMaterial;
  }

  private get noiseTexture(): DataTexture {
    this._noiseTexture =
      this._noiseTexture ?? generateMagicSquareDistributedKernelRotations(5);
    return this._noiseTexture;
  }

  private get sampleKernel(): Vector3[] {
    if (!this._sampleKernel.length) {
      this._sampleKernel = spiralQuadraticSampleKernel(
        ShadowAndAoRenderMaterial.kernelSize
      );
    }
    return this._sampleKernel;
  }

  constructor(
    depthAndNormalTextures: GBufferTextures,
    parameters?: ShadowAndAoRenderTargetsParameters
  ) {
    this.shadowAndAoParameters = this._getShadowAndAoParameters(
      parameters?.shAndAo
    );
    this._width = parameters?.width ?? 1024;
    this._height = parameters?.height ?? 1024;
    this._samples = parameters?.samples ?? 0;
    this._depthAndNormalTextures = depthAndNormalTextures;
    this._renderPass = parameters?.renderPass ?? new RenderPass();
  }

  private _getShadowAndAoParameters(
    parameters?: ShadowAndAoParameters
  ): ShadowAndAoParameters {
    return {
      ...defaultShadowAndAoParameters,
      ...parameters,
    };
  }

  public dispose() {
    this._noiseTexture?.dispose();
    this._passRenderMaterial?.dispose();
    this._passRenderTarget?.dispose();
  }

  public setSize(width: number, height: number) {
    this._width = width;
    this._height = height;
    this._passRenderMaterial?.update({
      width: this._width,
      height: this._height,
    });
  }

  public updateBounds(sceneBounds: SceneVolume, _shadowAndAoScale: number) {
    this._sceneBoxMin.copy(sceneBounds.bounds.min);
    this._sceneBoxMax.copy(sceneBounds.bounds.max);
    this._shadowAndAoScale = _shadowAndAoScale;
    this.parametersNeedsUpdate = true;
  }

  public render(
    renderer: WebGLRenderer,
    camera: Camera,
    shadowMapTexture: Texture
  ): void {
    this._renderPass.renderScreenSpace(
      renderer,
      this.updateSSAOMaterial(camera, shadowMapTexture),
      this.passRenderTarget
    );
    this.parametersNeedsUpdate = false;
  }

  public updateSSAOMaterial(
    camera: Camera,
    shadowTexture: Texture
  ): ShaderMaterial {
    const passRenderMaterial = this.passRenderMaterial;
    passRenderMaterial.updateDependencies({
      width: this._width,
      height: this._height,
      camera,
      shadowTexture,
      sceneBoxMin: this._sceneBoxMin,
      sceneBoxMax: this._sceneBoxMax,
    });
    if (this.parametersNeedsUpdate) {
      passRenderMaterial.updateSettings({
        ...this.shadowAndAoParameters,
        aoKernelRadius:
          this.shadowAndAoParameters.aoKernelRadius * this._shadowAndAoScale,
        aoMaxDistance:
          this.shadowAndAoParameters.aoMaxDistance * this._shadowAndAoScale,
        shadowRadius:
          this.shadowAndAoParameters.shadowRadius * this._shadowAndAoScale,
        aoIntensity: this.aoEnabled ? 1 : 0,
        shadowIntensity: this.shadowEnabled ? 1 : 0,
      });
    }
    return passRenderMaterial;
  }
}

const glslShadowAndAoVertexShader = `varying vec2 vUv;
  void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`;

const glslShadowAndAoFragmentShader = `uniform sampler2D tShadow;
  uniform sampler2D tNormal;
#if FLOAT_GBUFFER_RGB_NORMAL_ALPHA_DEPTH != 1 
  uniform sampler2D tDepth;
#endif  
  uniform sampler2D tNoise;
  uniform vec3 sampleKernel[KERNEL_SIZE];
  uniform vec2 resolution;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform mat4 cameraProjectionMatrix;
  uniform mat4 cameraInverseProjectionMatrix;
  uniform mat4 cameraWorldMatrix;
  uniform float aoKernelRadius;
  uniform float aoDepthBias; // avoid artifacts caused by neighbour fragments with minimal depth difference
  uniform float aoMaxDistance; // avoid the influence of fragments which are too far away
  uniform float aoMaxDepth;
  uniform float aoIntensity;
  uniform float aoFadeout;
  uniform float shKernelRadius;
  uniform float shIntensity;
  uniform vec3 sceneBoxMin;
  uniform vec3 sceneBoxMax;
  
  varying vec2 vUv;
  
  #include <packing>
  
  float getDepth(const in vec2 screenPosition) {
      #if FLOAT_GBUFFER_RGB_NORMAL_ALPHA_DEPTH == 1
          #if DEPTH_BUFFER_ANTIALIAS == 1
              vec2 size = vec2(textureSize(tNormal, 0));
              ivec2 p = ivec2(screenPosition * size);
              float d0 = texelFetch(tNormal, p, 0).w;
              vec2 depth = vec2(d0, 1.0);
              float d1 = texelFetch(tNormal, p + ivec2(1, 0), 0).w;
              depth += vec2(d1, 1.0) * step(abs(d1 - d0), 0.1);
              float d2 = texelFetch(tNormal, p - ivec2(1, 0), 0).w;
              depth += vec2(d2, 1.0) * step(abs(d2 - d0), 0.1);
              float d3 = texelFetch(tNormal, p + ivec2(0, 1), 0).w;
              depth += vec2(d3, 1.0) * step(abs(d3 - d0), 0.1);
              float d4 = texelFetch(tNormal, p - ivec2(0, 1), 0).w;
              depth += vec2(d4, 1.0) * step(abs(d4 - d0), 0.1);
              return depth.x / depth.y;
          #else
              return texture2D(tNormal, screenPosition).w;
          #endif
      #else    
          return texture2D(tDepth, screenPosition).x;
      #endif
  }
  
  float getViewZ(const in float depth) {
      #if PERSPECTIVE_CAMERA == 1
          return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
      #else
          return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
      #endif
  }
  
  vec3 getViewPosition(const in vec2 screenPosition, const in float depth) {
    vec4 clipSpacePosition = vec4(vec3(screenPosition, depth) * 2.0 - 1.0, 1.0);
    vec4 viewSpacePosition = cameraInverseProjectionMatrix * clipSpacePosition;
    return viewSpacePosition.xyz / viewSpacePosition.w;
  }

  vec3 getAntiAliasedViewNormal(const in vec2 screenPosition) {
    #if FLOAT_GBUFFER_RGB_NORMAL_ALPHA_DEPTH == 1
        #if NORMAL_VECTOR_ANTIALIAS == 1
            vec2 uv = screenPosition;
            vec2 size = vec2(textureSize(tNormal, 0));
            ivec2 p = ivec2(screenPosition * size);
            float c0 = texelFetch(tNormal, p, 0).a;
            float l2 = texelFetch(tNormal, p - ivec2(2, 0), 0).a;
            float l1 = texelFetch(tNormal, p - ivec2(1, 0), 0).a;
            float r1 = texelFetch(tNormal, p + ivec2(1, 0), 0).a;
            float r2 = texelFetch(tNormal, p + ivec2(2, 0), 0).a;
            float b2 = texelFetch(tNormal, p - ivec2(0, 2), 0).a;
            float b1 = texelFetch(tNormal, p - ivec2(0, 1), 0).a;
            float t1 = texelFetch(tNormal, p + ivec2(0, 1), 0).a;
            float t2 = texelFetch(tNormal, p + ivec2(0, 2), 0).a;
            float dl = abs((2.0 * l1 - l2) - c0);
            float dr = abs((2.0 * r1 - r2) - c0);
            float db = abs((2.0 * b1 - b2) - c0);
            float dt = abs((2.0 * t1 - t2) - c0);
            vec3 ce = getViewPosition(uv, c0).xyz;
            vec3 dpdx = (dl < dr) ?  ce - getViewPosition((uv - vec2(1.0 / size.x, 0.0)), l1).xyz
                                  : -ce + getViewPosition((uv + vec2(1.0 / size.x, 0.0)), r1).xyz;
            vec3 dpdy = (db < dt) ?  ce - getViewPosition((uv - vec2(0.0, 1.0 / size.y)), b1).xyz
                                  : -ce + getViewPosition((uv + vec2(0.0, 1.0 / size.y)), t1).xyz;
            return normalize(cross(dpdx, dpdy));
        #elif NORMAL_VECTOR_ANTIALIAS == 2
            vec2 size = vec2(textureSize(tNormal, 0));
            ivec2 p = ivec2(screenPosition * size);
            vec3 normalVector = texelFetch(tNormal, p, 0).xyz;
            normalVector += texelFetch(tNormal, p + ivec2(1, 0), 0).xyz;
            normalVector += texelFetch(tNormal, p - ivec2(1, 0), 0).xyz;
            normalVector += texelFetch(tNormal, p + ivec2(0, 1), 0).xyz;
            normalVector += texelFetch(tNormal, p - ivec2(0, 1), 0).xyz;
            return normalize(normalVector);
        #else
            return texture2D(tNormal, screenPosition).xyz;
        #endif
    #else
        return unpackRGBToNormal(texture2D(tNormal, screenPosition).xyz);
    #endif
  }

  vec3 getViewNormal(const in vec2 screenPosition) {
    #if FLOAT_GBUFFER_RGB_NORMAL_ALPHA_DEPTH == 1
        return texture2D(tNormal, screenPosition).xyz;
    #else
        return unpackRGBToNormal(texture2D(tNormal, screenPosition).xyz);
    #endif
  }
  
  void main() {
  
      float depth = getDepth(vUv);
      float viewZ = getViewZ(depth);
  
      vec3 viewPosition = getViewPosition(vUv, depth);
      vec3 viewNormal = getAntiAliasedViewNormal(vUv);
      vec3 worldPosition = (cameraWorldMatrix * vec4(viewPosition, 1.0)).xyz;
      float boxDistance = length(max(vec3(0.0), max(sceneBoxMin - worldPosition, worldPosition - sceneBoxMax)));
  
      vec2 noiseScale = resolution.xy / vec2(textureSize(tNoise, 0));
      vec3 random = texture2D(tNoise, vUv * noiseScale).xyz * 2.0 - 1.0;
  
      // compute matrix used to reorient a kernel vector
      vec3 tangent = normalize(random - viewNormal * dot(random, viewNormal));
      vec3 bitangent = cross(viewNormal, tangent);
      mat3 kernelMatrix = mat3(tangent, bitangent, viewNormal);
  
      float aoOcclusion = 0.0;
      float shOcclusion = texture2D(tShadow, vUv).r;
      float shSamples = 0.0;
      if (aoIntensity >= 0.01 && boxDistance < aoMaxDistance && length(viewNormal) > 0.01) {
          for (int i = 0; i < KERNEL_SIZE; i ++) {
              vec3 aoSampleVector = kernelMatrix * sampleKernel[i]; 
              vec3 aoSamplePoint = viewPosition + aoSampleVector * aoKernelRadius; 
              vec4 aoSamplePointNDC = cameraProjectionMatrix * vec4(aoSamplePoint, 1.0); 
              aoSamplePointNDC /= aoSamplePointNDC.w;
              vec2 aoSamplePointUv = aoSamplePointNDC.xy * 0.5 + 0.5;
              float aoRealSampleDepth = getDepth(aoSamplePointUv);
              float aoSampleDeltaZ = getViewZ(aoRealSampleDepth) - aoSamplePoint.z;
              float aoRealDeltaZ = viewZ - aoSamplePoint.z;
              float w_long = clamp((aoMaxDistance - max(aoRealDeltaZ, aoSampleDeltaZ)) / aoMaxDistance, 0.0, 1.0);
              float w_lat = clamp(1.0 - length(aoSampleVector.xy), 0.0, 1.0);
              aoOcclusion +=
                  step(aoRealSampleDepth, aoMaxDepth) * 
                  step(aoDepthBias, aoSampleDeltaZ / (cameraFar - cameraNear)) * 
                  step(aoSampleDeltaZ, aoMaxDistance) * mix(1.0, w_long * w_lat, aoFadeout);
          }
      }
      if (shIntensity >= 0.01 && length(viewNormal) > 0.01) {
          for (int i = 0; i < KERNEL_SIZE; i ++) {
              vec3 shSampleVector = kernelMatrix * sampleKernel[i]; // reorient sample vector in view space
              vec3 shSamplePoint = viewPosition + shSampleVector * shKernelRadius; // calculate sample point
              vec4 shSamplePointNDC = cameraProjectionMatrix * vec4(shSamplePoint, 1.0); // project point and calculate NDC
              shSamplePointNDC /= shSamplePointNDC.w;
              vec2 shSamplePointUv = shSamplePointNDC.xy * 0.5 + 0.5; // compute uv coordinates
              vec3 shSampleNormal = getViewNormal(shSamplePointUv);
              float shDeltaZ = getViewZ(getDepth(shSamplePointUv)) - shSamplePoint.z;
              float w = step(abs(shDeltaZ), shKernelRadius) * max(0.0, dot(shSampleNormal, viewNormal));
              shSamples += w;
              shOcclusion += texture2D(tShadow, shSamplePointUv).r * w;
          }
      }
  
      aoOcclusion = clamp(aoOcclusion / float(KERNEL_SIZE) * (1.0 + aoFadeout), 0.0, 1.0);
      aoOcclusion = 1.0 - aoOcclusion * clamp(1.0 - boxDistance / aoMaxDistance, 0.0, 1.0);
      shOcclusion = clamp(shOcclusion / (shSamples + 1.0), 0.0, 1.0);
      gl_FragColor = vec4(aoOcclusion, shOcclusion, 0.0, 1.0);
  }`;

export interface ShadowAndAoRenderMaterialParameters {
  floatGBufferRgbNormalAlphaDepth?: boolean;
  shadowTexture?: Texture;
  normalTexture?: Texture;
  depthTexture?: Texture;
  noiseTexture?: Texture;
  sampleKernel?: Vector3[];
  camera?: Camera;
  sceneBoxMin?: Vector3;
  sceneBoxMax?: Vector3;
  width?: number;
  height?: number;
  aoKernelRadius?: number;
  aoDepthBias?: number;
  aoMaxDistance?: number;
  aoMaxDepth?: number;
  aoIntensity?: number;
  aoFadeout?: number;
  shadowRadius?: number;
  shadowIntensity?: number;
}

export class ShadowAndAoRenderMaterial extends ShaderMaterial {
  public static kernelSize: number = 32;
  private static _shader = {
    uniforms: {
      tShadow: { value: null as Texture | null },
      tNormal: { value: null as Texture | null },
      tDepth: { value: null as Texture | null },
      tNoise: { value: null as Texture | null },
      sampleKernel: { value: null as Vector3[] | null },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1 },
      resolution: { value: new Vector2() },
      cameraProjectionMatrix: { value: new Matrix4() },
      cameraInverseProjectionMatrix: { value: new Matrix4() },
      cameraWorldMatrix: { value: new Matrix4() },
      aoKernelRadius: { value: 0.1 },
      aoDepthBias: { value: 0.001 },
      aoMaxDistance: { value: 0.05 },
      aoMaxDepth: { value: 0.99 },
      aoIntensity: { value: 1.0 },
      aoFadeout: { value: 0.0 },
      shKernelRadius: { value: 0.15 },
      shIntensity: { value: 1.0 },
      sceneBoxMin: { value: new Vector3(-1, -1, -1) },
      sceneBoxMax: { value: new Vector3(1, 1, 1) },
    },
    defines: {
      PERSPECTIVE_CAMERA: 1,
      KERNEL_SIZE: ShadowAndAoRenderMaterial.kernelSize,
      FLOAT_GBUFFER_RGB_NORMAL_ALPHA_DEPTH: 0,
      NORMAL_VECTOR_ANTIALIAS: 2,
      DEPTH_BUFFER_ANTIALIAS: 1,
    },
    vertexShader: glslShadowAndAoVertexShader,
    fragmentShader: glslShadowAndAoFragmentShader,
  };

  constructor(parameters?: ShadowAndAoRenderMaterialParameters) {
    super({
      defines: Object.assign({
        ...ShadowAndAoRenderMaterial._shader.defines,
        KERNEL_SIZE:
          parameters?.sampleKernel?.length ??
          ShadowAndAoRenderMaterial.kernelSize,
        FLOAT_GBUFFER_RGB_NORMAL_ALPHA_DEPTH:
          parameters?.floatGBufferRgbNormalAlphaDepth ? 1 : 0,
      }),
      uniforms: UniformsUtils.clone(ShadowAndAoRenderMaterial._shader.uniforms),
      vertexShader: ShadowAndAoRenderMaterial._shader.vertexShader,
      fragmentShader: ShadowAndAoRenderMaterial._shader.fragmentShader,
      blending: NoBlending,
    });
    this.update(parameters);
  }

  public update(
    parameters?: ShadowAndAoRenderMaterialParameters
  ): ShadowAndAoRenderMaterial {
    this.updateDependencies(parameters);
    this.updateSettings(parameters);
    return this;
  }

  public updateDependencies(parameters?: ShadowAndAoRenderMaterialParameters) {
    if (parameters?.shadowTexture !== undefined) {
      this.uniforms.tShadow.value = parameters?.shadowTexture;
    }
    if (parameters?.normalTexture !== undefined) {
      this.uniforms.tNormal.value = parameters?.normalTexture;
    }
    if (parameters?.depthTexture !== undefined) {
      this.uniforms.tDepth.value = parameters?.depthTexture;
    }
    if (parameters?.noiseTexture !== undefined) {
      this.uniforms.tNoise.value = parameters?.noiseTexture;
    }
    if (parameters?.width || parameters?.height) {
      const width = parameters?.width ?? this.uniforms.resolution.value.x;
      const height = parameters?.height ?? this.uniforms.resolution.value.y;
      this.uniforms.resolution.value.set(width, height);
    }
    if (parameters?.sampleKernel !== undefined) {
      this.uniforms.sampleKernel.value = parameters?.sampleKernel;
    }
    if (parameters?.sceneBoxMin !== undefined) {
      this.uniforms.sceneBoxMin.value = parameters?.sceneBoxMin;
    }
    if (parameters?.sceneBoxMax !== undefined) {
      this.uniforms.sceneBoxMax.value = parameters?.sceneBoxMax;
    }
    this._updateCameraDependentUniforms(parameters);
  }

  private _updateCameraDependentUniforms(
    parameters?: ShadowAndAoRenderMaterialParameters
  ) {
    if (parameters?.camera !== undefined) {
      const camera =
        (parameters?.camera as OrthographicCamera) ||
        (parameters?.camera as PerspectiveCamera);
      this.uniforms.cameraNear.value = camera.near;
      this.uniforms.cameraFar.value = camera.far;
      this.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
      this.uniforms.cameraInverseProjectionMatrix.value.copy(
        camera.projectionMatrixInverse
      );
      this.uniforms.cameraWorldMatrix.value.copy(camera.matrixWorld);
    }
  }

  public updateSettings(parameters?: ShadowAndAoRenderMaterialParameters) {
    if (parameters?.aoKernelRadius !== undefined) {
      this.uniforms.aoKernelRadius.value = parameters?.aoKernelRadius;
    }
    if (parameters?.aoDepthBias !== undefined) {
      this.uniforms.aoDepthBias.value = parameters?.aoDepthBias;
    }
    if (parameters?.aoMaxDistance !== undefined) {
      this.uniforms.aoMaxDistance.value = parameters?.aoMaxDistance;
    }
    if (parameters?.aoMaxDepth !== undefined) {
      this.uniforms.aoMaxDepth.value = parameters?.aoMaxDepth;
    }
    if (parameters?.aoIntensity !== undefined) {
      this.uniforms.aoIntensity.value = parameters?.aoIntensity;
    }
    if (parameters?.aoFadeout !== undefined) {
      this.uniforms.aoFadeout.value = parameters?.aoFadeout;
    }
    if (parameters?.shadowRadius !== undefined) {
      this.uniforms.shKernelRadius.value = parameters?.shadowRadius;
    }
    if (parameters?.shadowIntensity !== undefined) {
      this.uniforms.shIntensity.value = parameters?.shadowIntensity;
    }
  }
}
