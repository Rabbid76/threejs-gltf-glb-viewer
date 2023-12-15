import {
  generateMagicSquareDistributedKernelRotations,
  RenderPass,
} from '../render-utility';
import { NormalVectorSourceType, DepthValueSourceType } from './pass-utility';
import type { AoAlgorithmType } from '../shaders/ao-shader';
import {
  generateAoSampleKernelInitializer,
  AoAlgorithms,
  AOShader,
} from '../shaders/ao-shader';
import type {
  Camera,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three';
import {
  Box3,
  CustomBlending,
  DataTexture,
  LinearFilter,
  MinEquation,
  OneFactor,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UniformsUtils,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise';

export { AoAlgorithms, AoAlgorithmType } from '../shaders/ao-shader';

export interface AORenderPassParameters {
  [key: string]: any;
  resolutionScale: number;
  algorithm: AoAlgorithmType;
  samples: number;
  radius: number;
  distanceExponent: number;
  thickness: number;
  distanceFallOff: number;
  scale: number;
  bias: number;
  screenSpaceRadius: boolean;
}

export const defaultAORenderPassParameters: AORenderPassParameters = {
  resolutionScale: 1,
  algorithm: AoAlgorithms.SSAO,
  samples: 32,
  radius: 0.25,
  distanceExponent: 2, // 1
  thickness: 0.5,
  distanceFallOff: 0.5,
  scale: 1,
  bias: 0.01,
  screenSpaceRadius: false,
};

export interface AOPassParameters {
  aoParameters?: AORenderPassParameters;
  normalVectorSourceType?: NormalVectorSourceType;
  depthValueSourceType?: DepthValueSourceType;
  modulateRedChannel?: boolean;
  depthTexture?: Texture;
  normalTexture?: Texture;
}

export class AORenderPass {
  public needsUpdate: boolean = true;
  public parameters: AORenderPassParameters = {
    ...defaultAORenderPassParameters,
  };
  private _width: number = 0;
  private _height: number = 0;
  private _normalVectorSourceType: NormalVectorSourceType =
    NormalVectorSourceType.FLOAT_BUFFER_NORMAL;
  private _depthValueSourceType: DepthValueSourceType =
    DepthValueSourceType.NORMAL_VECTOR_ALPHA;
  private _modulateRedChannel: boolean = false;
  public depthTexture: Texture | null = null;
  public normalTexture: Texture | null = null;
  private _noiseTexture: Texture | null = null;
  private _aoMaterial?: ShaderMaterial;
  private _renderTarget: WebGLRenderTarget | null = null;
  private _renderPass: RenderPass = new RenderPass();
  private _sceneClipBox: Box3 = new Box3(
    new Vector3(-1, -1, -1),
    new Vector3(1, 1, 1)
  );
  private _sceneScale: number = 1;

  public get texture(): Texture | null {
    return this._renderTarget ? this._renderTarget?.texture : null;
  }

  constructor(width: number, height: number, parameters?: AOPassParameters) {
    this._width = width;
    this._height = height;
    this._normalVectorSourceType =
      parameters?.normalVectorSourceType ||
      NormalVectorSourceType.FLOAT_BUFFER_NORMAL;
    this._depthValueSourceType =
      parameters?.depthValueSourceType ||
      DepthValueSourceType.NORMAL_VECTOR_ALPHA;
    this._modulateRedChannel = parameters?.modulateRedChannel || false;
    if (parameters?.aoParameters) {
      this.parameters = parameters.aoParameters as AORenderPassParameters;
    }
    if (parameters) {
      this.updateTextures(parameters);
    }
  }

  private _getNoiseTexture(size = 64): Texture | null {
    if (!this._noiseTexture) {
      const simplex = new SimplexNoise();
      const data = new Uint8Array(size * size * 4);
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          const x = i;
          const y = j;

          data[(i * size + j) * 4] = (simplex.noise(x, y) + 1.0) * 127.5;
          data[(i * size + j) * 4 + 1] =
            (simplex.noise(x + size, y) + 1.0) * 127.5;
          data[(i * size + j) * 4 + 2] =
            (simplex.noise(x, y + size) + 1.0) * 127.5;
          data[(i * size + j) * 4 + 3] =
            (simplex.noise(x + size, y + size) + 1.0) * 127.5;
        }
      }
      this._noiseTexture = new DataTexture(
        data,
        size,
        size,
        RGBAFormat,
        UnsignedByteType
      );
      this._noiseTexture.wrapS = RepeatWrapping;
      this._noiseTexture.wrapT = RepeatWrapping;
      this._noiseTexture.needsUpdate = true;
    }
    return this._noiseTexture;
  }

  private _getMaterial(camera: Camera, needsUpdate: boolean): ShaderMaterial {
    let updateShader = needsUpdate;
    if (!this._aoMaterial) {
      this._aoMaterial = this._newAoMaterial();
      updateShader = true;
    }
    if (updateShader) {
      this._updateShader(this._aoMaterial, camera);
      this._aoMaterial.needsUpdate = true;
    }
    this._updateUniforms(this._aoMaterial, camera, updateShader);
    return this._aoMaterial;
  }

  private _newAoMaterial(): ShaderMaterial {
    const aoMaterial = new ShaderMaterial({
      defines: Object.assign({}, AOShader.defines),
      uniforms: UniformsUtils.clone(AOShader.uniforms),
      vertexShader: AOShader.vertexShader,
      fragmentShader: AOShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    if (this._modulateRedChannel) {
      aoMaterial.blending = CustomBlending;
      aoMaterial.blendEquation = MinEquation;
      aoMaterial.blendEquationAlpha = null;
      aoMaterial.blendSrc = OneFactor;
      aoMaterial.blendSrcAlpha = null;
      aoMaterial.blendDst = OneFactor;
      aoMaterial.blendDstAlpha = null;
    }
    aoMaterial.defines.FRAGMENT_OUTPUT = this._modulateRedChannel
      ? 'vec4(ao, 1., 1., 1.)'
      : undefined;
    //aoMaterial.uniforms.tNoise.value = this._getNoiseTexture();
    aoMaterial.uniforms.tNoise.value =
      generateMagicSquareDistributedKernelRotations(5);
    return aoMaterial;
  }

  private _updateShader(aoMaterial: ShaderMaterial, camera: Camera): void {
    aoMaterial.defines.PERSPECTIVE_CAMERA = (camera as PerspectiveCamera)
      .isPerspectiveCamera
      ? 1
      : 0;
    aoMaterial.defines.SAMPLES = this.parameters.samples;
    aoMaterial.defines.SAMPLE_VECTORS = generateAoSampleKernelInitializer(
      this.parameters.samples,
      this.parameters.algorithm === AoAlgorithms.SSAO
    );
    aoMaterial.defines.NORMAL_VECTOR_TYPE =
      this._normalVectorSourceType ===
      NormalVectorSourceType.FLOAT_BUFFER_NORMAL
        ? 2
        : 1;
    aoMaterial.defines.DEPTH_SWIZZLING =
      this._depthValueSourceType === DepthValueSourceType.NORMAL_VECTOR_ALPHA
        ? 'a'
        : 'x';
    aoMaterial.defines.AO_ALGORITHM = this.parameters.algorithm;
    aoMaterial.defines.NV_ALIGNED_SAMPLES =
      this.parameters.algorithm === AoAlgorithms.HBAO ||
      this.parameters.algorithm === AoAlgorithms.GTAO
        ? 0
        : 1;
    aoMaterial.defines.SCREEN_SPACE_RADIUS = this.parameters.screenSpaceRadius
      ? 1
      : 0;
    aoMaterial.defines.SCENE_CLIP_BOX = 1;
  }

  private _updateUniforms(
    aoMaterial: ShaderMaterial,
    camera: Camera,
    updateShader: boolean
  ): void {
    const sceneScale = this.parameters.screenSpaceRadius ? 1 : this._sceneScale;
    const depthTexture =
      this._depthValueSourceType === DepthValueSourceType.NORMAL_VECTOR_ALPHA
        ? this.normalTexture
        : this.depthTexture;
    aoMaterial.uniforms.tNormal.value = this.normalTexture as Texture;
    aoMaterial.uniforms.tDepth.value = depthTexture;
    aoMaterial.uniforms.resolution.value.set(this._width, this._height);
    aoMaterial.uniforms.cameraProjectionMatrix.value.copy(
      camera.projectionMatrix
    );
    aoMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(
      camera.projectionMatrixInverse
    );
    aoMaterial.uniforms.cameraWorldMatrix.value.copy(camera.matrixWorld);
    const currentCamera = camera as PerspectiveCamera | OrthographicCamera;
    aoMaterial.uniforms.cameraNear.value = currentCamera.near;
    aoMaterial.uniforms.cameraFar.value = currentCamera.far;
    if (updateShader) {
      aoMaterial.uniforms.radius.value = this.parameters.radius * sceneScale;
      aoMaterial.uniforms.distanceExponent.value =
        this.parameters.distanceExponent;
      aoMaterial.uniforms.thickness.value =
        this.parameters.thickness * sceneScale;
      aoMaterial.uniforms.distanceFallOff.value =
        this.parameters.distanceFallOff;
      aoMaterial.uniforms.scale.value = this.parameters.scale;
      if (this._sceneClipBox) {
        aoMaterial.uniforms.sceneBoxMin.value.copy(this._sceneClipBox.min);
        aoMaterial.uniforms.sceneBoxMax.value.copy(this._sceneClipBox.max);
      }
    }
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
    this._noiseTexture?.dispose();
    this._aoMaterial?.dispose();
    this._renderTarget?.dispose();
  }

  public setSize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._renderTarget?.setSize(width, height);
    this.needsUpdate = true;
  }

  public updateBounds(sceneClipBox: Box3, sceneScale?: number) {
    this._sceneClipBox = new Box3().copy(sceneClipBox);
    this._sceneScale = sceneScale ?? 1;
    this.needsUpdate = true;
  }

  public updateParameters(parameters: AORenderPassParameters) {
    for (let propertyName in parameters) {
      if (this.parameters.hasOwnProperty(propertyName)) {
        this.parameters[propertyName] = parameters[propertyName];
        this.needsUpdate = true;
      }
    }
  }

  public updateTextures(parameters: AOPassParameters) {
    if (parameters.depthTexture) {
      this.depthTexture = parameters.depthTexture;
      this.needsUpdate = true;
    }
    if (parameters.normalTexture) {
      this.normalTexture = parameters.normalTexture;
      this.needsUpdate = true;
    }
  }

  public clear(renderer: WebGLRenderer, renderTarget?: WebGLRenderTarget) {
    this._renderPass.clear(
      renderer,
      renderTarget ? renderTarget : this._getRenderTargets(),
      0xffffff,
      1
    );
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
