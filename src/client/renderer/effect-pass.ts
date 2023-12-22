import type { DenoisePass } from './render-utility';
import { RenderPass } from './render-utility';
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
} from './../../shaders/HBAOShader.js';
import {
  generatePdSamplePointInitializer,
  PoissonDenoiseShader,
  // @ts-ignore -- TS7016: Could not find declaration file
} from './../../shaders/PoissonDenoiseShader.js';

export enum NormalVectorSourceType {
  INPUT_RGB_NORMAL,
  FLOAT_BUFFER_NORMAL,
  CONSTANT_Z,
}

export enum DepthValueSourceType {
  SEPARATE_BUFFER,
  NORMAL_VECTOR_ALPHA,
}

export interface PoisonDenoiseParameters {
  [key: string]: any;
  iterations: number;
  radius: number;
  rings: number;
  lumaPhi: number;
  depthPhi: number;
  normalPhi: number;
  samples: number;
}

export interface HBAOEffectParameters {
  [key: string]: any;
  resolutionScale: number;
  samples: number;
  radius: number;
  distanceExponent: number;
  bias: number;
}

export const defaultHBAOEffectParameters: HBAOEffectParameters = {
  resolutionScale: 1,
  samples: 16,
  radius: 0.5,
  distanceExponent: 1,
  bias: 0.01,
};

export const defaultPoisonDenoiseParameters: PoisonDenoiseParameters = {
  iterations: 1,
  radius: 10,
  rings: 4,
  lumaPhi: 10,
  depthPhi: 12,
  normalPhi: 3.25,
  samples: 16,
};

export class HBAOEffect {
  public needsUpdate: boolean = true;
  public parameters: HBAOEffectParameters = {
    ...defaultHBAOEffectParameters,
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
      this.parameters = parameters.hbaoParameters as HBAOEffectParameters;
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
      camera.projectionMatrix
    );
    this._hbaoMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(
      camera.projectionMatrixInverse
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

export class PoissonDenoiseEffect implements DenoisePass {
  public needsUpdate: boolean = true;
  public parameters: PoisonDenoiseParameters = {
    ...defaultPoisonDenoiseParameters,
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
  private _renderPass: RenderPass = new RenderPass();

  public get texture(): Texture | null {
    return this.parameters.iterations > 0 && this._renderTargets.length > 0
      ? this._renderTargets[this._renderTargets.length - 1].texture
      : this._inputTexture;
    //return this.denoisePass ? this.denoisePass.texture : null;
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
    this._rgInputTexture = parameters?.rgInputTexture || true;
    this._inputTexture = parameters?.inputTexture || null;
    this.depthTexture = parameters?.depthTexture || null;
    this.normalTexture = parameters?.normalTexture || null;
    if (parameters.poisonDenoiseParameters) {
      this.parameters =
        parameters.poisonDenoiseParameters as PoisonDenoiseParameters;
    } else if (parameters) {
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
        UnsignedByteType
      );
      this._noiseTexture.wrapS = RepeatWrapping;
      this._noiseTexture.wrapT = RepeatWrapping;
      this._noiseTexture.needsUpdate = true;
      /*
      new TextureLoader().load(NoiseTexture, (noiseTexture: Texture) => {
        noiseTexture.minFilter = NearestFilter;
        noiseTexture.magFilter = NearestFilter;
        noiseTexture.wrapS = RepeatWrapping;
        noiseTexture.wrapT = RepeatWrapping;
        noiseTexture.colorSpace = NoColorSpace;
        this._noiseTexture = noiseTexture;
        if (this._pdMaterial) {
          this._pdMaterial.uniforms.tNoise.value = noiseTexture;
        }
      });
      */
    }
    return this._noiseTexture;
  }

  private _getMaterial(camera: Camera, needsUpdate: boolean): ShaderMaterial {
    let updateShader = needsUpdate;
    if (!this._pdMaterial) {
      this._pdMaterial = new ShaderMaterial({
        defines: Object.assign({}, PoissonDenoiseShader.defines),
        uniforms: UniformsUtils.clone(PoissonDenoiseShader.uniforms),
        vertexShader: PoissonDenoiseShader.vertexShader,
        fragmentShader: PoissonDenoiseShader.fragmentShader,
        depthTest: false,
        depthWrite: false,
      });
      this._pdMaterial.defines.SAMPLE_LUMINANCE = '(a.r * a.g)';
      this._pdMaterial.uniforms.tNoise.value = this._getNoiseTexture();
      updateShader = true;
    }
    if (updateShader) {
      this._pdMaterial.defines.SAMPLES = this.parameters.samples;
      this._pdMaterial.defines.SAMPLE_VECTORS =
        generatePdSamplePointInitializer(
          this.parameters.samples,
          this.parameters.rings
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
    }
    const depthTexture =
      this._depthValueSourceType === DepthValueSourceType.NORMAL_VECTOR_ALPHA
        ? this.normalTexture
        : this.depthTexture;
    this._pdMaterial.uniforms.tDiffuse.value = this._inputTexture as Texture;
    this._pdMaterial.uniforms.tNormal.value = this.normalTexture as Texture;
    this._pdMaterial.uniforms.tDepth.value = depthTexture;
    this._pdMaterial.uniforms.resolution.value.set(this._width, this._height);
    this._pdMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(
      camera.projectionMatrixInverse
    );
    this._pdMaterial.uniforms.lumaPhi.value = this.parameters.lumaPhi;
    this._pdMaterial.uniforms.depthPhi.value = this.parameters.depthPhi;
    this._pdMaterial.uniforms.normalPhi.value = this.parameters.normalPhi;
    this._pdMaterial.uniforms.radius.value = this.parameters.radius;
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

  public updateParameters(parameters: any) {
    for (const propertyName in parameters) {
      if (this.parameters.hasOwnProperty(propertyName)) {
        this.parameters[propertyName] = parameters[propertyName];
        this.needsUpdate = true;
      }
    }
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
    for (let i = 0; i < 2 * this.parameters.iterations; i++) {
      const inputRenderTarget = renderTargets[(i + 1) % 2];
      const outputRenderTarget = renderTargets[i % 2];
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
