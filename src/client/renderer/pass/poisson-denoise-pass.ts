import type { DenoisePass } from './../render-utility';
import type {
  NormalVectorSourceType,
  DepthValueSourceType,
} from './pass-utility';
import {
  NORMAL_VECTOR_SOURCE_TYPES,
  DEPTH_VALUE_SOURCE_TYPES,
} from './pass-utility';
import { PassRenderer } from './../render-utility';
import type { Camera, Texture, WebGLRenderer } from 'three';
import {
  Box3,
  DataTexture,
  LinearFilter,
  RepeatWrapping,
  RGFormat,
  RGBAFormat,
  ShaderMaterial,
  UniformsUtils,
  UnsignedByteType,
  WebGLRenderTarget,
} from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise';
import {
  generatePdSamplePointInitializer,
  poissonDenoiseShader,
} from '../shaders/poisson-denoise-shader';

export interface PoissonDenoisePassParameters {
  [key: string]: any;
  iterations: number;
  samples: number;
  rings: number;
  radiusExponent: number;
  radius: number;
  lumaPhi: number;
  depthPhi: number;
  normalPhi: number;
  nvOrientatedSamples?: boolean;
}

export const defaultPoissonDenoisePassParameters: PoissonDenoisePassParameters =
  {
    iterations: 2,
    samples: 16,
    rings: 2,
    radiusExponent: 1,
    radius: 5,
    lumaPhi: 10,
    depthPhi: 0.5,
    normalPhi: 1,
    nvOrientatedSamples: false,
  };

export interface PoissonDenoiseParameters {
  poissonDenoisePassParameters?: PoissonDenoisePassParameters;
  normalVectorSourceType?: NormalVectorSourceType;
  depthValueSourceType?: DepthValueSourceType;
  rgInputTexture?: boolean;
  luminanceType?: string;
  sampleLuminance?: string;
  fragmentOutput?: string;
  inputTexture?: Texture;
  depthTexture?: Texture;
  normalTexture?: Texture;
}

export class PoissonDenoiseRenderPass implements DenoisePass {
  public needsUpdate: boolean = true;
  public parameters: PoissonDenoisePassParameters = {
    ...defaultPoissonDenoisePassParameters,
  };
  private _width: number = 0;
  private _height: number = 0;
  private _normalVectorSourceType: NormalVectorSourceType =
    NORMAL_VECTOR_SOURCE_TYPES.FLOAT_BUFFER_NORMAL;
  private _depthValueSourceType: DepthValueSourceType =
    DEPTH_VALUE_SOURCE_TYPES.NORMAL_VECTOR_ALPHA;
  public _inputTexture: Texture | null = null;
  public depthTexture: Texture | null = null;
  public normalTexture: Texture | null = null;
  private _noiseTexture: Texture | null = null;
  private _pdMaterial?: ShaderMaterial;
  private _renderTargets: WebGLRenderTarget[] = [];
  private _outputRenderTargetIndex: number = 0;
  private _passRenderer: PassRenderer = new PassRenderer();
  private _sceneClipBox: Box3 | undefined;
  private _rgInputTexture: boolean = false;
  private _luminanceType: string;
  private _sampleLuminance: string;
  private _fragmentOutput: string;

  public get texture(): Texture | null {
    return this.parameters.iterations > 0 && this._renderTargets.length > 0
      ? this._renderTargets[this._outputRenderTargetIndex].texture
      : this._inputTexture;
  }

  public set inputTexture(texture: Texture | null) {
    this._inputTexture = texture;
  }

  constructor(
    width: number,
    height: number,
    parameters?: PoissonDenoiseParameters
  ) {
    this._width = width;
    this._height = height;
    this._normalVectorSourceType =
      parameters?.normalVectorSourceType ||
      NORMAL_VECTOR_SOURCE_TYPES.FLOAT_BUFFER_NORMAL;
    this._depthValueSourceType =
      parameters?.depthValueSourceType ||
      DEPTH_VALUE_SOURCE_TYPES.NORMAL_VECTOR_ALPHA;
    this._inputTexture = parameters?.inputTexture || null;
    this.depthTexture = parameters?.depthTexture || null;
    this.normalTexture = parameters?.normalTexture || null;
    this._rgInputTexture = parameters?.rgInputTexture || false;
    this._luminanceType = parameters?.luminanceType || 'vec3';
    this._sampleLuminance = parameters?.sampleLuminance || 'a';
    this._fragmentOutput =
      parameters?.fragmentOutput || 'vec4(denoised.xyz, 1.)';
    if (parameters?.poissonDenoisePassParameters) {
      this.parameters = parameters.poissonDenoisePassParameters;
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
    if (!this._pdMaterial) {
      this._pdMaterial = new ShaderMaterial({
        defines: Object.assign({}, poissonDenoiseShader.defines),
        uniforms: UniformsUtils.clone(poissonDenoiseShader.uniforms),
        vertexShader: poissonDenoiseShader.vertexShader,
        fragmentShader: poissonDenoiseShader.fragmentShader,
        depthTest: false,
        depthWrite: false,
      });
      this._pdMaterial.uniforms.tNoise.value = this._getNoiseTexture();
      updateShader = true;
    }
    if (updateShader) {
      this._updateShader(this._pdMaterial);
    }
    this._updateUniforms(this._pdMaterial, camera, updateShader);
    return this._pdMaterial;
  }

  private _updateShader(pdMaterial: ShaderMaterial): void {
    pdMaterial.defines.SAMPLES = this.parameters.samples;
    pdMaterial.defines.SAMPLE_VECTORS = generatePdSamplePointInitializer(
      this.parameters.samples,
      this.parameters.rings,
      this.parameters.radiusExponent
    );
    pdMaterial.defines.SAMPLE_DISTRIBUTION = this.parameters.nvOrientatedSamples
      ? 1
      : 0;
    pdMaterial.defines.NORMAL_VECTOR_TYPE =
      this._normalVectorSourceType ===
      NORMAL_VECTOR_SOURCE_TYPES.FLOAT_BUFFER_NORMAL
        ? 2
        : 1;
    pdMaterial.defines.DEPTH_VALUE_SOURCE =
      this._depthValueSourceType ===
      DEPTH_VALUE_SOURCE_TYPES.NORMAL_VECTOR_ALPHA
        ? 1
        : 0;
    pdMaterial.needsUpdate = true;
    pdMaterial.defines.LUMINANCE_TYPE = this._luminanceType;
    pdMaterial.defines.SAMPLE_LUMINANCE = this._sampleLuminance;
    pdMaterial.defines.FRAGMENT_OUTPUT = this._fragmentOutput;
    pdMaterial.defines.SCENE_CLIP_BOX = this._sceneClipBox ? 1 : 0;
    pdMaterial.needsUpdate = true;
  }

  private _updateUniforms(
    pdMaterial: ShaderMaterial,
    camera: Camera,
    updateShader: boolean
  ): void {
    const depthTexture =
      this._depthValueSourceType ===
      DEPTH_VALUE_SOURCE_TYPES.NORMAL_VECTOR_ALPHA
        ? this.normalTexture
        : this.depthTexture;
    pdMaterial.uniforms.tDiffuse.value = this._inputTexture as Texture;
    pdMaterial.uniforms.tNormal.value = this.normalTexture as Texture;
    pdMaterial.uniforms.tDepth.value = depthTexture;
    pdMaterial.uniforms.resolution.value.set(this._width, this._height);
    pdMaterial.uniforms.cameraProjectionMatrix.value.copy(
      camera.projectionMatrix
    );
    pdMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(
      camera.projectionMatrixInverse
    );
    pdMaterial.uniforms.cameraWorldMatrix.value.copy(camera.matrixWorld);
    if (updateShader) {
      pdMaterial.uniforms.lumaPhi.value = this.parameters.lumaPhi;
      pdMaterial.uniforms.depthPhi.value = this.parameters.depthPhi;
      pdMaterial.uniforms.normalPhi.value = this.parameters.normalPhi;
      pdMaterial.uniforms.radius.value = this.parameters.radius;
      pdMaterial.uniforms.radiusExponent.value = this.parameters.radiusExponent;
      if (this._sceneClipBox) {
        pdMaterial.uniforms.sceneBoxMin.value.copy(this._sceneClipBox.min);
        pdMaterial.uniforms.sceneBoxMax.value.copy(this._sceneClipBox.max);
      }
    }
  }

  private _getRenderTargets(): WebGLRenderTarget[] {
    if (this._renderTargets.length < 2) {
      this._renderTargets = [
        new WebGLRenderTarget(this._width, this._height, {
          format: this._rgInputTexture ? RGFormat : RGBAFormat,
          magFilter: LinearFilter,
          minFilter: LinearFilter,
        }),
        new WebGLRenderTarget(this._width, this._height, {
          format: this._rgInputTexture ? RGFormat : RGBAFormat,
          magFilter: LinearFilter,
          minFilter: LinearFilter,
        }),
      ];
    }
    return this._renderTargets;
  }

  public dispose(): void {
    this._noiseTexture?.dispose();
    this._pdMaterial?.dispose();
    this._renderTargets.forEach((target) => target.dispose());
  }

  public setSize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._renderTargets.forEach((target) => target.setSize(width, height));
    this.needsUpdate = true;
  }

  public updateBounds(sceneClipBox: Box3) {
    this._sceneClipBox = new Box3().copy(sceneClipBox);
    this.needsUpdate = true;
  }

  public updateParameters(parameters: PoissonDenoisePassParameters) {
    for (const propertyName in parameters) {
      if (this.parameters.hasOwnProperty(propertyName)) {
        this.parameters[propertyName] = parameters[propertyName];
        this.needsUpdate = true;
      }
    }
  }

  public updateTextures(parameters: PoissonDenoiseParameters) {
    if (parameters.inputTexture) {
      this._inputTexture = parameters.inputTexture;
      this.needsUpdate = true;
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

  public render(renderer: WebGLRenderer, camera: Camera) {
    const pdMaterial = this._getMaterial(camera, this.needsUpdate);
    this.needsUpdate = false;
    const renderTargets = this._getRenderTargets();
    for (let i = 0; i < this.parameters.iterations; i++) {
      const inputRenderTarget = renderTargets[(i + 1) % 2];
      this._outputRenderTargetIndex = i % 2;
      const outputRenderTarget = renderTargets[this._outputRenderTargetIndex];
      pdMaterial.uniforms.tDiffuse.value =
        i === 0 ? this._inputTexture : inputRenderTarget.texture;
      pdMaterial.uniforms.index.value = i;
      this._passRenderer.renderScreenSpace(
        renderer,
        pdMaterial,
        outputRenderTarget,
        0xffffff,
        1.0
      );
    }
  }

  public renderToTarget(
    renderer: WebGLRenderer,
    camera: Camera,
    renderTarget: WebGLRenderTarget
  ) {
    const pdMaterial = this._getMaterial(camera, this.needsUpdate);
    this.needsUpdate = false;
    this._passRenderer.renderScreenSpace(
      renderer,
      pdMaterial,
      renderTarget,
      0xffffff,
      1.0
    );
  }
}
