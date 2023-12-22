import type { DenoisePass } from './../render-utility';
import { NormalVectorSourceType, DepthValueSourceType } from './pass-utility';
import { RenderPass } from './../render-utility';
import type { Camera, Texture, WebGLRenderer } from 'three';
import {
  DataTexture,
  LinearFilter,
  RepeatWrapping,
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
}

export const defaultPoissonDenoisePassParameters: PoissonDenoisePassParameters =
  {
    iterations: 2,
    samples: 16,
    rings: 2,
    radiusExponent: 1,
    radius: 5,
    lumaPhi: 10,
    depthPhi: 2,
    normalPhi: 4,
  };

export interface PoissonDenoiseParameters {
  poissonDenoisePassParameters?: PoissonDenoisePassParameters;
  normalVectorSourceType?: NormalVectorSourceType;
  depthValueSourceType?: DepthValueSourceType;
  rgInputTexture?: boolean;
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
    NormalVectorSourceType.FLOAT_BUFFER_NORMAL;
  private _depthValueSourceType: DepthValueSourceType =
    DepthValueSourceType.NORMAL_VECTOR_ALPHA;
  private _rgInputTexture: boolean = true;
  public _inputTexture: Texture | null = null;
  public depthTexture: Texture | null = null;
  public normalTexture: Texture | null = null;
  private _noiseTexture: Texture | null = null;
  private _pdMaterial?: ShaderMaterial;
  private _renderTargets: WebGLRenderTarget[] = [];
  private _outputRenderTargetIndex: number = 0;
  private _renderPass: RenderPass = new RenderPass();

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
      NormalVectorSourceType.FLOAT_BUFFER_NORMAL;
    this._depthValueSourceType =
      parameters?.depthValueSourceType ||
      DepthValueSourceType.NORMAL_VECTOR_ALPHA;
    this._rgInputTexture = parameters?.rgInputTexture || true;
    this._inputTexture = parameters?.inputTexture || null;
    this.depthTexture = parameters?.depthTexture || null;
    this.normalTexture = parameters?.normalTexture || null;
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
      this._pdMaterial.defines.SAMPLES = this.parameters.samples;
      this._pdMaterial.defines.SAMPLE_VECTORS =
        generatePdSamplePointInitializer(
          this.parameters.samples,
          this.parameters.rings,
          this.parameters.radiusExponent
        );
      this._pdMaterial.defines.NORMAL_VECTOR_TYPE =
        this._normalVectorSourceType ===
        NormalVectorSourceType.FLOAT_BUFFER_NORMAL
          ? 2
          : 1;
      this._pdMaterial.defines.DEPTH_VALUE_SOURCE =
        this._depthValueSourceType === DepthValueSourceType.NORMAL_VECTOR_ALPHA
          ? 1
          : 0;
      this._pdMaterial.needsUpdate = true;
      this._pdMaterial.defines.LUMINANCE_TYPE = 'vec3';
      this._pdMaterial.defines.SAMPLE_LUMINANCE = 'a';
    }
    const depthTexture =
      this._depthValueSourceType === DepthValueSourceType.NORMAL_VECTOR_ALPHA
        ? this.normalTexture
        : this.depthTexture;
    this._pdMaterial.uniforms.tDiffuse.value = this._inputTexture as Texture;
    this._pdMaterial.uniforms.tNormal.value = this.normalTexture as Texture;
    this._pdMaterial.uniforms.tDepth.value = depthTexture;
    this._pdMaterial.uniforms.resolution.value.set(this._width, this._height);
    this._pdMaterial.uniforms.cameraProjectionMatrix.value.copy(
      camera.projectionMatrix
    );
    this._pdMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(
      camera.projectionMatrixInverse
    );
    this._pdMaterial.uniforms.lumaPhi.value = this.parameters.lumaPhi;
    this._pdMaterial.uniforms.depthPhi.value = this.parameters.depthPhi;
    this._pdMaterial.uniforms.normalPhi.value = this.parameters.normalPhi;
    this._pdMaterial.uniforms.radius.value = this.parameters.radius;
    this._pdMaterial.uniforms.radiusExponent.value =
      this.parameters.radiusExponent;
    return this._pdMaterial;
  }

  private _getRenderTargets(): WebGLRenderTarget[] {
    if (this._renderTargets.length < 2) {
      this._renderTargets = [
        new WebGLRenderTarget(this._width, this._height, {
          magFilter: LinearFilter,
          minFilter: LinearFilter,
        }),
        new WebGLRenderTarget(this._width, this._height, {
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
      this._renderPass.renderScreenSpace(
        renderer,
        pdMaterial,
        outputRenderTarget,
        0xffffff,
        1.0
      );
    }
  }
}
