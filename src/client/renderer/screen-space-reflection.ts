import type { SceneVolume } from './render-utility';
import { RenderPass } from './render-utility';
import { GBufferRenderTargets } from './gbuffer-render-target';
import {
  NormalVectorSourceType,
  DepthValueSourceType,
} from './pass/pass-utility';
// @ts-ignore -- TS7016: Could not find declaration file
import { SSRShader } from './../../shaders/SSRShader.js';
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
  FramebufferTexture,
  LinearFilter,
  Matrix4,
  ShaderMaterial,
  UniformsUtils,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { CopyTransformMaterial, CopyMaterialBlendMode } from './shader-utility';

export interface SSRParameters {
  [key: string]: any;
  enabled: boolean;
  opacity: number;
  maxDistance: number;
  thickness: number;
}

export const defaultSSRParameters: SSRParameters = {
  enabled: false,
  opacity: 0.5,
  maxDistance: 0.75,
  thickness: 0.018,
};

export class ScreenSpaceReflection {
  private _width: number = 0;
  private _height: number = 0;
  private _samples: number = 0;
  private _ssrRenderPass: SSRRenderPass;
  private _renderPass: RenderPass;
  private _sharedGBufferRenderTarget?: GBufferRenderTargets;
  private _gBufferRenderTarget?: GBufferRenderTargets;
  private _blendMaterial: CopyTransformMaterial;
  private _copyDiffuseFrameTexture?: FramebufferTexture;

  public get parameters(): SSRParameters {
    return this._ssrRenderPass.parameters;
  }

  public get ssrRenderPass(): SSRRenderPass {
    return this._ssrRenderPass;
  }

  public get texture(): Texture | null {
    return this._ssrRenderPass ? this._ssrRenderPass?.texture : null;
  }

  public get colorCopyTexture(): Texture | null {
    return this._copyDiffuseFrameTexture ? this._copyDiffuseFrameTexture : null;
  }

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

  constructor(
    width: number,
    height: number,
    samples: number,
    parameters?: any
  ) {
    if (parameters?.gBufferRenderTarget) {
      this._sharedGBufferRenderTarget = parameters?.gBufferRenderTarget;
    }
    this._width = width;
    this._height = height;
    this._samples = samples;
    this._ssrRenderPass = new SSRRenderPass(width, height, parameters);
    this._blendMaterial = new CopyTransformMaterial(
      {},
      CopyMaterialBlendMode.DEFAULT
    );
    this._renderPass = parameters?.renderPass || new RenderPass();
  }

  public dispose(): void {
    this._gBufferRenderTarget?.dispose();
    this._ssrRenderPass?.dispose();
    this._blendMaterial?.dispose();
    this._copyDiffuseFrameTexture?.dispose();
  }

  public setSize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._gBufferRenderTarget?.setSize(width, height);
    this._ssrRenderPass?.setSize(width, height);
    this._copyDiffuseFrameTexture?.dispose();
    this._copyDiffuseFrameTexture = undefined;
  }

  public updateBounds(sceneBounds: SceneVolume) {
    this._ssrRenderPass?.updateBounds(sceneBounds);
  }

  public render(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    illuminationBufferTexture: Texture | null,
    fadeInMix: number = 0
  ): void {
    if (
      !this._ssrRenderPass.parameters.enabled ||
      this._ssrRenderPass.parameters.opacity === 0 ||
      fadeInMix > 0.999
    ) {
      return;
    }
    this._copyDiffuseFrameTexture =
      this._copyDiffuseFrameTexture ??
      new FramebufferTexture(
        this._width * renderer.getPixelRatio(),
        this._height * renderer.getPixelRatio()
      );
    renderer.copyFramebufferToTexture(
      new Vector2(),
      this._copyDiffuseFrameTexture
    );
    this.gBufferRenderTarget.render(renderer, scene, camera);
    this._ssrRenderPass.inputTexture = this._copyDiffuseFrameTexture;
    this._ssrRenderPass.depthTexture =
      this.gBufferRenderTarget.depthBufferTexture;
    this._ssrRenderPass.normalTexture = this.gBufferRenderTarget.gBufferTexture;
    this._ssrRenderPass.illuminationBufferTexture = illuminationBufferTexture;
    this._ssrRenderPass.render(renderer, camera, scene);
    this._renderToTarget(renderer, this._ssrRenderPass.texture, fadeInMix);
  }

  private _renderToTarget(
    renderer: WebGLRenderer,
    finalTexture: Texture | null,
    fadeInMix: number = 0
  ): void {
    this._blendMaterial.update({
      texture: finalTexture,
      blending: CustomBlending,
      // prettier-ignore
      colorTransform: new Matrix4().set(
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0,  1 - fadeInMix,
      ),
      multiplyChannels: 0,
    });
    this._renderPass.renderScreenSpace(
      renderer,
      this._blendMaterial,
      renderer.getRenderTarget()
    );
  }
}

export class SSRRenderPass {
  public needsUpdate: boolean = true;
  public parameters: SSRParameters = {
    ...defaultSSRParameters,
  };
  private _width: number = 0;
  private _height: number = 0;
  private _normalVectorSourceType: NormalVectorSourceType =
    NormalVectorSourceType.FLOAT_BUFFER_NORMAL;
  private _depthValueSourceType: DepthValueSourceType =
    DepthValueSourceType.NORMAL_VECTOR_ALPHA;
  public _inputTexture: Texture | null = null;
  public depthTexture: Texture | null = null;
  public normalTexture: Texture | null = null;
  public illuminationBufferTexture: Texture | null = null;
  private _ssrMaterial?: ShaderMaterial;
  private _renderTarget: WebGLRenderTarget | null = null;
  private _renderPass: RenderPass;
  private _sceneBoxMin: Vector3 = new Vector3(-1, -1, -1);
  private _sceneBoxMax: Vector3 = new Vector3(1, 1, 1);

  public get texture(): Texture | null {
    return this._renderTarget ? this._renderTarget?.texture : null;
  }

  public set inputTexture(texture: Texture | null) {
    this._inputTexture = texture;
  }

  constructor(width: number, height: number, parameters?: any) {
    this._width = width;
    this._height = height;
    this._normalVectorSourceType =
      parameters?.normalVectorSourceType ||
      NormalVectorSourceType.FLOAT_BUFFER_NORMAL;
    this._depthValueSourceType =
      parameters?.depthValueSourceType ||
      DepthValueSourceType.NORMAL_VECTOR_ALPHA;
    this._renderPass = parameters?.renderPass || new RenderPass();
    if (parameters?.ssrParameters) {
      this.parameters = parameters.ssrParameters as SSRParameters;
    }
    if (parameters) {
      this.updateParameters(parameters);
    }
  }

  private _getMaterial(camera: Camera, needsUpdate: boolean): ShaderMaterial {
    let updateShader = needsUpdate;
    if (!this._ssrMaterial) {
      this._ssrMaterial = new ShaderMaterial({
        defines: Object.assign({}, SSRShader.defines),
        uniforms: UniformsUtils.clone(SSRShader.uniforms),
        vertexShader: SSRShader.vertexShader,
        fragmentShader: SSRShader.fragmentShader,
        depthTest: false,
        depthWrite: false,
      });
      updateShader = true;
    }
    if (updateShader) {
      const diagnalDist = Math.sqrt(
        this._width * this._width + this._height * this._height
      );
      this._ssrMaterial.defines.MAX_STEP = Math.min(diagnalDist, 400);
      this._ssrMaterial.defines.NO_GROUND_REFLECTION = 1;
      this._ssrMaterial.defines.FILTER_ILLUMINATION = this
        .illuminationBufferTexture
        ? 1
        : 0;
      this._ssrMaterial.defines.PERSPECTIVE_CAMERA = (
        camera as PerspectiveCamera
      ).isPerspectiveCamera
        ? 1
        : 0;
      this._ssrMaterial.defines.NORMAL_VECTOR_TYPE =
        this._normalVectorSourceType ===
        NormalVectorSourceType.FLOAT_BUFFER_NORMAL
          ? 2
          : 1;
      this._ssrMaterial.defines.DEPTH_VALUE_SOURCE =
        this._depthValueSourceType === DepthValueSourceType.NORMAL_VECTOR_ALPHA
          ? 1
          : 0;
      this._ssrMaterial.needsUpdate = true;
    }
    const depthTexture =
      this._depthValueSourceType === DepthValueSourceType.NORMAL_VECTOR_ALPHA
        ? this.normalTexture
        : this.depthTexture;
    this._ssrMaterial.uniforms.tDiffuse.value = this._inputTexture as Texture;
    this._ssrMaterial.uniforms.tNormal.value = this.normalTexture as Texture;
    this._ssrMaterial.uniforms.tDepth.value = depthTexture;
    this._ssrMaterial.uniforms.tIllumination.value =
      this.illuminationBufferTexture;
    this._ssrMaterial.uniforms.resolution.value.set(this._width, this._height);
    this._ssrMaterial.uniforms.cameraMatrixWorld.value.copy(camera.matrixWorld);
    this._ssrMaterial.uniforms.cameraProjectionMatrix.value.copy(
      camera.projectionMatrix
    );
    this._ssrMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(
      camera.projectionMatrixInverse
    );
    this._ssrMaterial.uniforms.sceneBoxMin.value.copy(this._sceneBoxMin);
    this._ssrMaterial.uniforms.sceneBoxMax.value.copy(this._sceneBoxMax);
    const currentCamera = camera as PerspectiveCamera | OrthographicCamera;
    this._ssrMaterial.uniforms.cameraNear.value = currentCamera.near;
    this._ssrMaterial.uniforms.cameraFar.value = currentCamera.far;
    this._ssrMaterial.uniforms.opacity.value = this.parameters.opacity;
    this._ssrMaterial.uniforms.maxDistance.value = this.parameters.maxDistance;
    this._ssrMaterial.uniforms.thickness.value = this.parameters.thickness;
    return this._ssrMaterial;
  }

  private _getRenderTargets(): WebGLRenderTarget {
    if (!this._renderTarget) {
      this._renderTarget = new WebGLRenderTarget(this._width, this._height, {
        magFilter: LinearFilter,
        minFilter: LinearFilter,
      });
    }
    return this._renderTarget;
  }

  public dispose(): void {
    this._ssrMaterial?.dispose();
    this._renderTarget?.dispose();
  }

  public setSize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._renderTarget?.setSize(width, height);
    this.needsUpdate = true;
  }

  public updateBounds(sceneBounds: SceneVolume) {
    this._sceneBoxMin.copy(sceneBounds.bounds.min);
    this._sceneBoxMax.copy(sceneBounds.bounds.max);
  }

  public updateParameters(parameters: any) {
    for (const propertyName in parameters) {
      if (this.parameters.hasOwnProperty(propertyName)) {
        this.parameters[propertyName] = parameters[propertyName];
        this.needsUpdate = true;
      }
    }
    if (parameters.depthTexture) {
      this.depthTexture = parameters.depthTexture;
      this.needsUpdate = true;
    }
    if (parameters.normalTexture) {
      this.normalTexture = parameters.normalTexture;
      this.needsUpdate = true;
    }
  }

  public render(
    renderer: WebGLRenderer,
    camera: Camera,
    scene: Scene,
    renderTarget?: WebGLRenderTarget
  ) {
    const hbaoMaterial = this._getMaterial(camera, this.needsUpdate);
    this.needsUpdate = false;
    this._renderPass.renderScreenSpace(
      renderer,
      hbaoMaterial,
      renderTarget ? renderTarget : this._getRenderTargets()
    );
  }
}
