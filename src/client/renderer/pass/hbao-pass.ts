import { RenderPass } from '../render-utility';
import { NormalVectorSourceType, DepthValueSourceType } from './pass-utility';
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
  DataTexture,
  LinearFilter,
  MinEquation,
  OneFactor,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UniformsUtils,
  UnsignedByteType,
  WebGLRenderTarget,
} from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise';
import {
  generateHaboSampleKernelInitializer,
  HBAOShader,
  // @ts-ignore -- TS7016: Could not find declaration file
} from 'three/examples/jsm/shaders/HBAOShader.js';

export interface HBAORenderPassParameters {
  [key: string]: any;
  resolutionScale: number;
  samples: number;
  radius: number;
  distanceExponent: number;
  bias: number;
}

export const defaultHBAORenderPassParameters: HBAORenderPassParameters = {
  resolutionScale: 1,
  samples: 16,
  radius: 0.5,
  distanceExponent: 1,
  bias: 0.01,
};

export class HBAORenderPass {
  public needsUpdate: boolean = true;
  public parameters: HBAORenderPassParameters = {
    ...defaultHBAORenderPassParameters,
  };
  private _width: number = 0;
  private _height: number = 0;
  private _loaded: boolean = false;
  private _normalVectorSourceType: NormalVectorSourceType =
    NormalVectorSourceType.FLOAT_BUFFER_NORMAL;
  private _depthValueSourceType: DepthValueSourceType =
    DepthValueSourceType.NORMAL_VECTOR_ALPHA;
  private _modulateRedChannel: boolean = false;
  public depthTexture: Texture | null = null;
  public normalTexture: Texture | null = null;
  private _noiseTexture: Texture | null = null;
  private _hbaoMaterial?: ShaderMaterial;
  private _renderTarget: WebGLRenderTarget | null = null;
  private _renderPass: RenderPass = new RenderPass();

  public get texture(): Texture | null {
    return this._renderTarget ? this._renderTarget?.texture : null;
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
    this._modulateRedChannel = parameters?.modulateRedChannel || false;
    if (parameters?.hbaoParameters) {
      this.parameters = parameters.hbaoParameters as HBAORenderPassParameters;
    }
    if (parameters) {
      this.updateParameters(parameters);
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

          data[(i * size + j) * 4] = (simplex.noise(x, y) + 1.0) * 255.0;
          data[(i * size + j) * 4 + 1] =
            (simplex.noise(x + size, y) + 1.0) * 255.0;
          data[(i * size + j) * 4 + 2] =
            (simplex.noise(x, y + size) + 1.0) * 255.0;
          data[(i * size + j) * 4 + 3] =
            (simplex.noise(x + size, y + size) + 1.0) * 255.0;
        }
      }
      this._noiseTexture = new DataTexture(
        data,
        size,
        size,
        RGBAFormat,
        UnsignedByteType,
      );
      this._noiseTexture.wrapS = RepeatWrapping;
      this._noiseTexture.wrapT = RepeatWrapping;
      this._noiseTexture.needsUpdate = true;
    }
    return this._noiseTexture;
  }

  private _getMaterial(camera: Camera, needsUpdate: boolean): ShaderMaterial {
    let updateShader = needsUpdate;
    if (!this._hbaoMaterial) {
      this._hbaoMaterial = new ShaderMaterial({
        defines: Object.assign({}, HBAOShader.defines),
        uniforms: UniformsUtils.clone(HBAOShader.uniforms),
        vertexShader: HBAOShader.vertexShader,
        fragmentShader: HBAOShader.fragmentShader,
        depthTest: false,
        depthWrite: false,
      });
      if (this._modulateRedChannel) {
        this._hbaoMaterial.blending = CustomBlending;
        this._hbaoMaterial.blendEquation = MinEquation;
        this._hbaoMaterial.blendEquationAlpha = null;
        this._hbaoMaterial.blendSrc = OneFactor;
        this._hbaoMaterial.blendSrcAlpha = null;
        this._hbaoMaterial.blendDst = OneFactor;
        this._hbaoMaterial.blendDstAlpha = null;
      }
      this._hbaoMaterial.defines.FRAGMENT_OUTPUT = this._modulateRedChannel
        ? 'vec4(ao, 1., 1., 1.)'
        : undefined;
      this._hbaoMaterial.uniforms.tNoise.value = this._getNoiseTexture();
      updateShader = true;
    }
    if (updateShader) {
      this._hbaoMaterial.defines.PERSPECTIVE_CAMERA = (
        camera as PerspectiveCamera
      ).isPerspectiveCamera
        ? 1
        : 0;
      this._hbaoMaterial.defines.SAMPLES = this.parameters.samples;
      this._hbaoMaterial.defines.SAMPLE_VECTORS =
        generateHaboSampleKernelInitializer(this.parameters.samples);
      this._hbaoMaterial.defines.NORMAL_VECTOR_TYPE =
        this._normalVectorSourceType ===
        NormalVectorSourceType.FLOAT_BUFFER_NORMAL
          ? 2
          : 1;
      this._hbaoMaterial.defines.DEPTH_VALUE_SOURCE =
        this._depthValueSourceType === DepthValueSourceType.NORMAL_VECTOR_ALPHA
          ? 1
          : 0;
      this._hbaoMaterial.needsUpdate = true;
    }
    const depthTexture =
      this._depthValueSourceType === DepthValueSourceType.NORMAL_VECTOR_ALPHA
        ? this.normalTexture
        : this.depthTexture;
    this._hbaoMaterial.uniforms.tNormal.value = this.normalTexture as Texture;
    this._hbaoMaterial.uniforms.tDepth.value = depthTexture;
    this._hbaoMaterial.uniforms.resolution.value.set(this._width, this._height);
    this._hbaoMaterial.uniforms.cameraProjectionMatrix.value.copy(
      camera.projectionMatrix,
    );
    this._hbaoMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(
      camera.projectionMatrixInverse,
    );
    const currentCamera = camera as PerspectiveCamera | OrthographicCamera;
    this._hbaoMaterial.uniforms.cameraNear.value = currentCamera.near;
    this._hbaoMaterial.uniforms.cameraFar.value = currentCamera.far;
    this._hbaoMaterial.uniforms.radius.value = this.parameters.radius;
    this._hbaoMaterial.uniforms.distanceExponent.value =
      this.parameters.distanceExponent;
    this._hbaoMaterial.uniforms.bias.value = this.parameters.bias;
    return this._hbaoMaterial;
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
    this._hbaoMaterial?.dispose();
    this._renderTarget?.dispose();
  }

  public setSize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._renderTarget?.setSize(width, height);
    this.needsUpdate = true;
  }

  public updateParameters(parameters: any) {
    for (let propertyName in parameters) {
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
    renderTarget?: WebGLRenderTarget,
  ) {
    const hbaoMaterial = this._getMaterial(camera, this.needsUpdate);
    this.needsUpdate = false;
    this._renderPass.renderScreenSpace(
      renderer,
      hbaoMaterial,
      renderTarget ? renderTarget : this._getRenderTargets(),
    );
  }
}
