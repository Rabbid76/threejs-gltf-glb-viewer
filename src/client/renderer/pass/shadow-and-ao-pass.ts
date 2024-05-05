import type { Enumify } from '../../utils/types';
import { RenderPass } from './render-pass';
import type { RenderPassManager } from '../render-pass-manager';
import {
  COLOR_COPY_BLEND_MODES,
  CopyTransformMaterial,
  DEFAULT_TRANSFORM,
  ZERO_RGBA,
} from '../shader-utility';
import type { DenoisePass, SceneVolume } from '../render-utility';
import {
  NORMAL_VECTOR_SOURCE_TYPES,
  DEPTH_VALUE_SOURCE_TYPES,
} from './pass-utility';
import { CameraUpdate } from '../render-utility';
import type { AORenderPassParameters } from './ao-pass';
import { defaultAORenderPassParameters, AORenderPass } from './ao-pass';
import { BlendAoAndAShadowMaterial } from '../materials/blend-ao-and-shadow-material';
import type { PoissonDenoisePassParameters } from './poisson-denoise-pass';
import {
  defaultPoissonDenoisePassParameters,
  PoissonDenoiseRenderPass,
} from './poisson-denoise-pass';
import type {
  Camera,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three';
import {
  CustomBlending,
  Matrix4,
  NearestFilter,
  NoBlending,
  RGFormat,
  WebGLRenderTarget,
} from 'three';

export const SHADOW_BLUR_TYPES = {
  OFF: 'off',
  HARD: 'hard',
  POISSON: 'poisson',
  FULL: 'full',
} as const;

export type ShadowBlurType = Enumify<typeof SHADOW_BLUR_TYPES>;

export interface ShadowParameters {
  [key: string]: any;
  shadowRadius: number;
}

export interface ShadowAndAoPassParameters {
  enabled: boolean;
  applyToMaterial: boolean;
  aoIntensity: number;
  shadowIntensity: number;
  aoOnGround: boolean;
  shadowOnGround: boolean;
  alwaysUpdate: boolean;
  progressiveDenoiseIterations: number;
  shadow: ShadowParameters;
  ao: AORenderPassParameters;
  poissonDenoise: PoissonDenoisePassParameters;
}

export const defaultShadowParameters: ShadowParameters = {
  shadowRadius: 0.05,
};

export const defaultPassParameters = {
  enabled: true,
  applyToMaterial: true,
  aoIntensity: 0.5,
  shadowIntensity: 0.35,
  aoOnGround: true,
  shadowOnGround: false,
  alwaysUpdate: false,
  progressiveDenoiseIterations: 0,
};

export interface ShadowAndAoPassConstructorParameters {
  enabled?: boolean;
  applyToMaterial?: boolean;
  aoIntensity?: number;
  shadowIntensity?: number;
  aoOnGround?: boolean;
  shadowOnGround?: boolean;
  alwaysUpdate?: boolean;
  progressiveDenoiseIterations?: number;
  shadow?: ShadowParameters;
  ao?: AORenderPassParameters;
  poissonDenoise?: PoissonDenoisePassParameters;
}

export interface ShadowAndAoPassSettings {
  shadowMapTexture: Texture | null;
  shadowBlurType: ShadowBlurType;
  shadowFadeInBlurType: ShadowBlurType;
  shadowFadeInMix: number;
  noOStaticFrames: number;
}

export class ShadowAndAoPass extends RenderPass {
  // prettier-ignore
  public static shadowTransform: Matrix4 = new Matrix4().set(
    0, 1, 0, 0,
    0, 1, 0, 0,
    0, 1, 0, 0,
    0, 0, 0, 1
  );
  public parameters: ShadowAndAoPassParameters;
  public needsUpdate: boolean = true;
  public renderToRenderTarget: boolean = false;
  public shadowAndAoPassSettings: ShadowAndAoPassSettings = {
    shadowMapTexture: null,
    shadowBlurType: SHADOW_BLUR_TYPES.FULL,
    shadowFadeInBlurType: SHADOW_BLUR_TYPES.FULL,
    shadowFadeInMix: 0,
    noOStaticFrames: 0,
  };
  private _width: number;
  private _height: number;
  private _samples: number;
  private _aoAndSoftShadowRenderTarget?: WebGLRenderTarget;
  private _softShadowPass?: PoissonDenoiseRenderPass;
  private _aoPass?: AORenderPass;
  private _fadeRenderTarget?: WebGLRenderTarget;
  private _poissonDenoisePass?: PoissonDenoiseRenderPass;
  private _copyMaterial: CopyTransformMaterial;
  private _blendMaterial: CopyTransformMaterial;
  private _blendAoAndShadowMaterial: BlendAoAndAShadowMaterial;
  private _cameraUpdate: CameraUpdate = new CameraUpdate();
  private _finalTexture: Texture | null = null;
  private _onlyHardShadow: boolean = false;

  public get aoAndSoftShadowRenderTarget(): WebGLRenderTarget {
    this._aoAndSoftShadowRenderTarget =
      this._aoAndSoftShadowRenderTarget ??
      new WebGLRenderTarget(this._width, this._height, {
        samples: this._samples,
        format: RGFormat,
        magFilter: NearestFilter,
        minFilter: NearestFilter,
      });
    return this._aoAndSoftShadowRenderTarget;
  }

  public get aoRenderPass(): AORenderPass {
    if (!this._aoPass) {
      this._aoPass = new AORenderPass(
        this._width,
        this._height,
        this._samples,
        !this.parameters.applyToMaterial,
        {
          normalVectorSourceType: this.gBufferTextures
            .isFloatGBufferWithRgbNormalAlphaDepth
            ? NORMAL_VECTOR_SOURCE_TYPES.FLOAT_BUFFER_NORMAL
            : NORMAL_VECTOR_SOURCE_TYPES.INPUT_RGB_NORMAL,
          depthValueSourceType: this.gBufferTextures
            .isFloatGBufferWithRgbNormalAlphaDepth
            ? DEPTH_VALUE_SOURCE_TYPES.NORMAL_VECTOR_ALPHA
            : DEPTH_VALUE_SOURCE_TYPES.SEPARATE_BUFFER,
          modulateRedChannel: true,
          aoParameters: this.parameters.ao,
        }
      );
    }
    return this._aoPass;
  }

  public get softShadowPass(): PoissonDenoiseRenderPass {
    if (!this._softShadowPass) {
      this._softShadowPass = new PoissonDenoiseRenderPass(
        this._width,
        this._height,
        this._samples,
        {
          inputTexture: undefined,
          depthTexture: this.gBufferTextures.depthBufferTexture,
          normalTexture: this.gBufferTextures.gBufferTexture,
          normalVectorSourceType: this.gBufferTextures
            .isFloatGBufferWithRgbNormalAlphaDepth
            ? NORMAL_VECTOR_SOURCE_TYPES.FLOAT_BUFFER_NORMAL
            : NORMAL_VECTOR_SOURCE_TYPES.INPUT_RGB_NORMAL,
          depthValueSourceType: this.gBufferTextures
            .isFloatGBufferWithRgbNormalAlphaDepth
            ? DEPTH_VALUE_SOURCE_TYPES.NORMAL_VECTOR_ALPHA
            : DEPTH_VALUE_SOURCE_TYPES.SEPARATE_BUFFER,
          rgInputTexture: true,
          luminanceType: 'float',
          sampleLuminance: 'a.x',
          fragmentOutput:
            'vec4(1.0, denoised.x, vec2(fract(depth * 1024.0), floor(depth * 1024.0)))',
          poissonDenoisePassParameters: {
            iterations: 1,
            samples: 16,
            rings: 2,
            radiusExponent: 1,
            radius: this.parameters.shadow.shadowRadius,
            lumaPhi: 10,
            depthPhi: 0.1,
            normalPhi: 4,
            nvOrientatedSamples: true,
          },
        }
      );
    } else {
      const softShadowPass = this._softShadowPass;
      softShadowPass.depthTexture = this.gBufferTextures.depthBufferTexture;
      softShadowPass.normalTexture = this.gBufferTextures.gBufferTexture;
    }
    return this._softShadowPass;
  }

  public get fadeRenderTarget(): WebGLRenderTarget {
    this._fadeRenderTarget =
      this._fadeRenderTarget ??
      new WebGLRenderTarget(this._width, this._height, {
        samples: this._samples,
        format: RGFormat,
        magFilter: NearestFilter,
        minFilter: NearestFilter,
      });
    return this._fadeRenderTarget;
  }

  public get denoisePass(): DenoisePass {
    if (!this._poissonDenoisePass) {
      this._poissonDenoisePass = new PoissonDenoiseRenderPass(
        this._width,
        this._height,
        this._samples,
        {
          inputTexture: this.aoAndSoftShadowRenderTarget.texture,
          depthTexture: this.gBufferTextures.depthBufferTexture,
          normalTexture: this.gBufferTextures.gBufferTexture,
          normalVectorSourceType: this.gBufferTextures
            .isFloatGBufferWithRgbNormalAlphaDepth
            ? NORMAL_VECTOR_SOURCE_TYPES.FLOAT_BUFFER_NORMAL
            : NORMAL_VECTOR_SOURCE_TYPES.INPUT_RGB_NORMAL,
          depthValueSourceType: this.gBufferTextures
            .isFloatGBufferWithRgbNormalAlphaDepth
            ? DEPTH_VALUE_SOURCE_TYPES.NORMAL_VECTOR_ALPHA
            : DEPTH_VALUE_SOURCE_TYPES.SEPARATE_BUFFER,
          rgInputTexture: true,
          fragmentOutput:
            'vec4(denoised.xy, vec2(fract(depth * 1024.0), floor(depth * 1024.0)))',
          poissonDenoisePassParameters: this.parameters.poissonDenoise,
        }
      );
    } else {
      const denoisePass = this._poissonDenoisePass;
      denoisePass.depthTexture = this.gBufferTextures.depthBufferTexture;
      denoisePass.normalTexture = this.gBufferTextures.gBufferTexture;
    }
    return this._poissonDenoisePass;
  }

  public get denoiseRenderTargetTexture(): Texture | null {
    return this.denoisePass ? this.denoisePass.texture : null;
  }

  public get finalTexture(): Texture | null {
    return this._finalTexture;
  }

  constructor(
    renderPassManager: RenderPassManager,
    width: number,
    height: number,
    samples: number,
    parameters?: ShadowAndAoPassConstructorParameters
  ) {
    super(renderPassManager);
    this._width = width;
    this._height = height;
    this._samples = samples;
    this.parameters = {
      enabled: parameters?.enabled ?? defaultPassParameters.enabled,
      applyToMaterial:
        parameters?.applyToMaterial ?? defaultPassParameters.applyToMaterial,
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
      shadow: {
        ...defaultShadowParameters,
      },
      ao: {
        ...defaultAORenderPassParameters,
      },
      poissonDenoise: {
        ...defaultPoissonDenoisePassParameters,
      },
    };
    this._copyMaterial = new CopyTransformMaterial();
    this._blendMaterial = new CopyTransformMaterial(
      {},
      COLOR_COPY_BLEND_MODES.DEFAULT
    );
    this._blendAoAndShadowMaterial = new BlendAoAndAShadowMaterial();
  }

  public dispose() {
    super.dispose();
    this._aoAndSoftShadowRenderTarget?.dispose();
    this._softShadowPass?.dispose();
    this._aoPass?.dispose();
    this._fadeRenderTarget?.dispose();
    this._poissonDenoisePass?.dispose();
    this._copyMaterial?.dispose();
    this._blendMaterial?.dispose();
    this._blendAoAndShadowMaterial?.dispose();
  }

  public setSize(width: number, height: number) {
    this._width = width;
    this._height = height;
    this._aoAndSoftShadowRenderTarget?.setSize(width, height);
    this._softShadowPass?.setSize(width, height);
    this._aoPass?.setSize(width, height);
    this._fadeRenderTarget?.setSize(width, height);
    this._poissonDenoisePass?.setSize(this._width, this._height);
    this.needsUpdate = true;
  }

  public updateParameters(parameters: ShadowAndAoPassParameters) {
    if (parameters.enabled !== undefined) {
      this.parameters.enabled = parameters.enabled;
    }
    if (parameters.applyToMaterial !== undefined) {
      this.parameters.applyToMaterial = parameters.applyToMaterial;
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
    if (parameters?.shadow) {
      for (const propertyName in parameters.shadow) {
        if (this.parameters.shadow.hasOwnProperty(propertyName)) {
          this.parameters.shadow[propertyName] =
            parameters.shadow[propertyName];
        }
      }
      if (this._softShadowPass) {
        this._softShadowPass.needsUpdate = true;
      }
    }
    if (parameters?.ao) {
      for (const propertyName in parameters.ao) {
        if (this.parameters.ao.hasOwnProperty(propertyName)) {
          this.parameters.ao[propertyName] = parameters.ao[propertyName];
        }
      }
      if (this._aoPass) {
        this._aoPass?.updateParameters(parameters?.ao);
      }
    }
    if (parameters?.poissonDenoise) {
      if (this._poissonDenoisePass) {
        this._poissonDenoisePass?.updateParameters(parameters?.poissonDenoise);
      } else {
        for (const propertyName in parameters.poissonDenoise) {
          if (this.parameters.poissonDenoise.hasOwnProperty(propertyName)) {
            this.parameters.poissonDenoise[propertyName] =
              parameters.poissonDenoise[propertyName];
          }
        }
      }
    }
  }

  public updateBounds(sceneBounds: SceneVolume, _shadowAndAoScale: number) {
    this._softShadowPass?.updateBounds(sceneBounds.bounds);
    this._aoPass?.updateBounds(sceneBounds.bounds, _shadowAndAoScale);
  }

  private _getRenderConditions(
    shadowFadeInBlurType: ShadowBlurType = SHADOW_BLUR_TYPES.FULL,
    shadowFadeInMix: number = 0,
    noOStaticFrames: number = 0
  ) {
    const fadeInPoissonShadow =
      shadowFadeInBlurType === SHADOW_BLUR_TYPES.POISSON &&
      shadowFadeInMix > 0.001;
    const fadeInHardShadow =
      shadowFadeInBlurType === SHADOW_BLUR_TYPES.HARD &&
      shadowFadeInMix > 0.001 &&
      shadowFadeInMix < 0.999;
    const onlyHardShadow =
      shadowFadeInBlurType === SHADOW_BLUR_TYPES.HARD && !fadeInHardShadow;
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

  public renderPass(renderer: WebGLRenderer): void {
    if (!this._setRenderState()) {
      return;
    }
    const renderConditions = this._getRenderConditions(
      this.shadowAndAoPassSettings.shadowFadeInBlurType,
      this.shadowAndAoPassSettings.shadowFadeInMix,
      this.shadowAndAoPassSettings.noOStaticFrames
    );
    let needsDenoise = false;
    if (
      !renderConditions.onlyHardShadow &&
      this.shadowAndAoPassSettings.shadowBlurType === SHADOW_BLUR_TYPES.FULL &&
      this._evaluateIfUpdateIsNeeded(this.camera)
    ) {
      this._renderShadowAndAo(
        renderer,
        this.scene,
        this.camera,
        this.shadowAndAoPassSettings.shadowMapTexture as Texture
      );
      needsDenoise = true;
    }
    let finalTexture: Texture | null = renderConditions.onlyHardShadow
      ? this.shadowAndAoPassSettings.shadowMapTexture
      : this.denoiseRenderTargetTexture;
    if (renderConditions.fadeInPoissonShadow) {
      finalTexture = this._renderDynamicShadow(
        renderer,
        this.aoAndSoftShadowRenderTarget.texture,
        this.shadowAndAoPassSettings.shadowMapTexture,
        this.shadowAndAoPassSettings.shadowFadeInMix
      );
      needsDenoise = true;
    }
    if (needsDenoise) {
      finalTexture = this._renderDenoise(
        renderer,
        this.camera,
        renderConditions.fadeInPoissonShadow,
        false
      );
    } else if (renderConditions.progressiveDenoise) {
      finalTexture = this._renderDenoise(renderer, this.camera, false, true);
    }
    if (renderConditions.fadeInHardShadow) {
      finalTexture = this._renderDynamicShadow(
        renderer,
        this.denoiseRenderTargetTexture,
        this.shadowAndAoPassSettings.shadowMapTexture,
        this.shadowAndAoPassSettings.shadowFadeInMix
      );
    }
    this._finalTexture = finalTexture;
    this._onlyHardShadow = renderConditions.onlyHardShadow;
    if (this.renderToRenderTarget) {
      this.renderToTarget(renderer);
    }
  }

  private _setRenderState(): boolean {
    if (
      !this.parameters.enabled ||
      !(
        this.parameters.ao.algorithm !== null ||
        this.parameters.shadowIntensity >= 0.01
      )
    ) {
      return false;
    }
    if (this.needsUpdate) {
      if (this._aoPass) {
        this._aoPass.needsUpdate = true;
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
    const renderAo =
      this.parameters.ao.algorithm !== null &&
      this.parameters.aoIntensity > 0.01;
    if (!renderAo) {
      this._aoPass?.clear(renderer, this.aoAndSoftShadowRenderTarget);
    }
    this._renderSoftShadow(renderer, camera, shadowMapTexture);
    if (renderAo) {
      this._renderAo(renderer, scene, camera);
    }
  }

  private _renderAo(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera
  ): void {
    const depthTexture = this.gBufferTextures.depthBufferTexture;
    const normalTexture = this.gBufferTextures.gBufferTexture;
    const renderTarget = this._aoAndSoftShadowRenderTarget;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const aoPass = this.aoRenderPass;
    aoPass.depthTexture = depthTexture;
    aoPass.normalTexture = normalTexture;
    aoPass.render(renderer, camera, scene, renderTarget);
    renderer.autoClear = autoClear;
  }

  private _renderSoftShadow(
    renderer: WebGLRenderer,
    camera: Camera,
    shadowMapTexture: Texture
  ): void {
    const softShadowPass = this.softShadowPass;
    softShadowPass.parameters.radius = this.parameters.shadow.shadowRadius;
    softShadowPass.inputTexture = shadowMapTexture;
    this.softShadowPass.renderToTarget(
      renderer,
      camera,
      this.aoAndSoftShadowRenderTarget
    );
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
        colorBase: ZERO_RGBA,
        multiplyChannels: 0,
      });
      this.passRenderer.renderScreenSpace(
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
      this.passRenderer.renderScreenSpace(
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
        : this.aoAndSoftShadowRenderTarget.texture;
    denoisePass.render(renderer, camera);
    return denoisePass.texture;
  }

  public renderToTarget(renderer: WebGLRenderer): void {
    const aoChannel = this._onlyHardShadow
      ? this.parameters.shadowIntensity
      : this.parameters.aoIntensity;
    const shadowChannel = this._onlyHardShadow
      ? 0
      : this.parameters.shadowIntensity;
    this.passRenderer.renderScreenSpace(
      renderer,
      this._blendAoAndShadowMaterial.update({
        texture: this._finalTexture,
        blending: CustomBlending,
        aoIntensity: aoChannel,
        shadowIntensity: shadowChannel,
      }),
      renderer.getRenderTarget()
    );
  }
}
