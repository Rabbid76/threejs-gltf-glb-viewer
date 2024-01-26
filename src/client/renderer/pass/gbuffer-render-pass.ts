import { RenderPass } from './render-pass';
import type { RenderPassManager } from '../render-pass-manager';
import type { CopyTransformMaterialParameters } from '../shader-utility';
import {
  ALPHA_RGBA,
  ALPHA_TRANSFORM,
  CopyTransformMaterial,
  DEFAULT_UV_TRANSFORM,
} from '../shader-utility';
import { ObjectRenderCache } from '../render-cache';
import type { GBufferNormalDepthMaterial } from '../materials/normal-depth-material';
import { NormalAndDepthRenderMaterial } from '../materials/normal-depth-material';
import type {
  Camera,
  MagnificationTextureFilter,
  Mesh,
  Object3D,
  Scene,
  ShaderMaterial,
  Texture,
  TextureFilter,
  WebGLRenderer,
} from 'three';
import {
  DepthStencilFormat,
  DepthTexture,
  FloatType,
  Material,
  MeshNormalMaterial,
  MeshPhysicalMaterial,
  NearestFilter,
  NoBlending,
  UnsignedInt248Type,
  WebGLRenderTarget,
} from 'three';

export interface GBufferTextures {
  get isFloatGBufferWithRgbNormalAlphaDepth(): boolean;
  get gBufferTexture(): Texture;
  get depthBufferTexture(): Texture;
  get textureWithDepthValue(): Texture;
}

export interface GBufferParameters {
  [key: string]: any;
  depthNormalScale: number;
}

export interface GBufferRenderTargetsParameters {
  capabilities?: any;
  textureMinificationFilter?: TextureFilter;
  textureMagnificationFilter?: MagnificationTextureFilter;
  width?: number;
  height?: number;
  samples?: number;
  shared?: boolean;
  depthNormalScale?: number;
}

export class GBufferRenderPass extends RenderPass implements GBufferTextures {
  public parameters: GBufferParameters;
  public readonly floatRgbNormalAlphaDepth: boolean = false;
  public readonly linearDepth: boolean = false;
  public copyToSeparateDepthBuffer: boolean = false;
  private _gBufferMaterialCache?: GBufferMaterialCache;
  private _targetMinificationTextureFilter: TextureFilter;
  private _targetMagnificationTextureFilter: MagnificationTextureFilter;
  private _width: number;
  private _height: number;
  private _samples: number;
  private _gBufferRenderMaterial?: GBufferNormalDepthMaterial;
  private _depthNormalRenderTarget?: WebGLRenderTarget;
  private _separateDeptRenderTarget?: WebGLRenderTarget;
  private _copyMaterial?: CopyTransformMaterial;
  private _shared: boolean;
  public needsUpdate: boolean = true;
  public drawGround: boolean = true;

  public set groundDepthWrite(value: boolean) {
    if (this._gBufferMaterialCache) {
      this._gBufferMaterialCache.groundDepthWrite = value;
    }
  }

  public get isFloatGBufferWithRgbNormalAlphaDepth(): boolean {
    return this.floatRgbNormalAlphaDepth;
  }
  public get gBufferTexture(): Texture {
    return this.depthNormalRenderTarget.texture;
  }
  public get depthBufferTexture(): Texture {
    return this.copyToSeparateDepthBuffer && this.floatRgbNormalAlphaDepth
      ? this.separateDeptRenderTarget.texture
      : this.depthNormalRenderTarget.depthTexture;
  }

  public get textureWithDepthValue(): Texture {
    return this.floatRgbNormalAlphaDepth
      ? this.depthNormalRenderTarget.texture
      : this.depthNormalRenderTarget.depthTexture;
  }

  public updateGBufferRenderMaterial(camera: Camera): Material {
    this._gBufferRenderMaterial =
      this._gBufferRenderMaterial ??
      (this.floatRgbNormalAlphaDepth
        ? new NormalAndDepthRenderMaterial({
            blending: NoBlending,
            floatBufferType: true,
            linearDepth: false,
          })
        : new MeshNormalMaterial({ blending: NoBlending }));
    if (this._gBufferRenderMaterial instanceof NormalAndDepthRenderMaterial) {
      this._gBufferRenderMaterial.update({ camera });
    }
    return this._gBufferRenderMaterial;
  }

  public get depthNormalRenderTarget(): WebGLRenderTarget {
    if (!this._depthNormalRenderTarget) {
      if (this.floatRgbNormalAlphaDepth) {
        this._depthNormalRenderTarget = new WebGLRenderTarget(
          this._width * this.parameters.depthNormalScale,
          this._height * this.parameters.depthNormalScale,
          {
            minFilter: this._targetMinificationTextureFilter,
            magFilter: this._targetMagnificationTextureFilter,
            type: FloatType,
            samples: this._samples,
          }
        );
      } else {
        const depthTexture = new DepthTexture(
          this._width * this.parameters.depthNormalScale,
          this._height * this.parameters.depthNormalScale
        );
        depthTexture.format = DepthStencilFormat;
        depthTexture.type = UnsignedInt248Type;
        this._depthNormalRenderTarget = new WebGLRenderTarget(
          this._width * this.parameters.depthNormalScale,
          this._height * this.parameters.depthNormalScale,
          {
            minFilter: this._targetMinificationTextureFilter,
            magFilter: this._targetMagnificationTextureFilter,
            depthTexture,
          }
        );
      }
    }
    return this._depthNormalRenderTarget;
  }

  public get separateDeptRenderTarget(): WebGLRenderTarget {
    if (!this._separateDeptRenderTarget) {
      this._separateDeptRenderTarget = new WebGLRenderTarget(
        this._width * this.parameters.depthNormalScale,
        this._height * this.parameters.depthNormalScale,
        {
          minFilter: this._targetMinificationTextureFilter,
          magFilter: this._targetMagnificationTextureFilter,
          //format: RedFormat,
          type: FloatType,
          samples: 0,
        }
      );
    }
    return this._separateDeptRenderTarget;
  }

  constructor(
    renderPassManager: RenderPassManager,
    parameters?: GBufferRenderTargetsParameters
  ) {
    super(renderPassManager);
    this.floatRgbNormalAlphaDepth = parameters?.capabilities?.isWebGL2 ?? false;
    if (this.renderCacheManager) {
      this._gBufferMaterialCache = new GBufferMaterialCache();
      this.renderCacheManager.registerCache(this, this._gBufferMaterialCache);
    }
    this.parameters = {
      depthNormalScale: parameters?.depthNormalScale ?? 1,
    };
    this._targetMinificationTextureFilter =
      parameters?.textureMinificationFilter ?? NearestFilter;
    this._targetMagnificationTextureFilter =
      parameters?.textureMagnificationFilter ?? NearestFilter;
    this._width = parameters?.width ?? 1024;
    this._height = parameters?.height ?? 1024;
    this._samples = parameters?.samples ?? 0;
    this._shared = parameters?.shared ?? false;
  }

  public dispose() {
    super.dispose();
    this._gBufferRenderMaterial?.dispose();
    this._depthNormalRenderTarget?.dispose();
  }

  public setSize(width: number, height: number) {
    this._width = width;
    this._height = height;
    this._depthNormalRenderTarget?.setSize(
      this._width * this.parameters.depthNormalScale,
      this._height * this.parameters.depthNormalScale
    );
  }

  public renderPass(renderer: WebGLRenderer): void {
    if (this._shared && !this.needsUpdate) {
      return;
    }
    this.needsUpdate = false;
    this.renderPassManager.setGroundVisibility(this.drawGround);
    if (this.renderCacheManager) {
      this.renderCacheManager.render(this, this.scene, () => {
        this._renderGBuffer(renderer, this.scene, this.camera);
      });
    } else {
      this._renderGBuffer(renderer, this.scene, this.camera);
    }
    this.renderPassManager.setGroundVisibility(false);
    if (this.floatRgbNormalAlphaDepth && this.copyToSeparateDepthBuffer) {
      this._copyDepthToSeparateDepthTexture(
        renderer,
        this.depthNormalRenderTarget
      );
    }
  }

  private _renderGBuffer(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera
  ) {
    this.passRenderer.renderWithOverrideMaterial(
      renderer,
      scene,
      camera,
      this.updateGBufferRenderMaterial(camera),
      this.depthNormalRenderTarget,
      0x7777ff,
      1.0
    );
  }

  protected getCopyMaterial(
    parameters?: CopyTransformMaterialParameters
  ): ShaderMaterial {
    this._copyMaterial ??= new CopyTransformMaterial();
    return this._copyMaterial.update(parameters);
  }

  private _copyDepthToSeparateDepthTexture(
    renderer: WebGLRenderer,
    source: WebGLRenderTarget
  ) {
    this.passRenderer.renderScreenSpace(
      renderer,
      this.getCopyMaterial({
        texture: source.texture,
        blending: NoBlending,
        colorTransform: ALPHA_TRANSFORM,
        colorBase: ALPHA_RGBA,
        multiplyChannels: 0,
        uvTransform: DEFAULT_UV_TRANSFORM,
      }),
      this.separateDeptRenderTarget
    );
  }
}

export class GBufferMaterialCache extends ObjectRenderCache {
  private _groundDepthWrite: boolean = true;

  set groundDepthWrite(value: boolean) {
    this._groundDepthWrite = value;
  }

  public constructor() {
    super();
  }

  public dispose(): void {
    // nothing to do
  }

  public addLineOrPoint(object3d: Object3D): void {
    this.addToCache(object3d, { visible: false });
  }

  public addMesh(mesh: Mesh): void {
    if (mesh.userData.isFloor) {
      this.addToCache(mesh, { visible: this._groundDepthWrite });
    } else if (mesh.visible) {
      if (
        mesh.material instanceof Material &&
        ((mesh.material.transparent && mesh.material.opacity < 0.7) ||
          mesh.material.alphaTest > 0)
      ) {
        this.addToCache(mesh, { visible: false });
      } else if (
        mesh.material instanceof MeshPhysicalMaterial &&
        mesh.material.transmission > 0
      ) {
        this.addToCache(mesh, { visible: false });
      }
    }
  }

  public addObject(_object3d: Object3D): void {
    // nothing to do
  }
}
