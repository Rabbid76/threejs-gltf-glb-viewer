import type { PassRenderer } from '../render-utility';
import type { RenderCacheManager } from '../render-cache';
import type { RenderPassManager } from '../render-pass-manager';
import type { GBufferTextures } from './gbuffer-render-pass';
import type { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass';

export abstract class RenderPass extends Pass {
  private _renderPassManager: RenderPassManager;

  protected get renderPassManager(): RenderPassManager {
    return this._renderPassManager;
  }

  protected get renderCacheManager(): RenderCacheManager {
    return this._renderPassManager.renderCacheManager;
  }

  protected get scene(): Scene {
    return this._renderPassManager.scene;
  }

  protected get camera(): Camera {
    return this._renderPassManager.camera;
  }

  protected get gBufferTextures(): GBufferTextures {
    return this._renderPassManager.gBufferRenderPass;
  }

  protected get passRenderer(): PassRenderer {
    return this._renderPassManager.passRenderer;
  }

  constructor(renderPassManager: RenderPassManager) {
    super();
    this._renderPassManager = renderPassManager;
  }

  public render(
    renderer: WebGLRenderer,
    _writeBuffer: WebGLRenderTarget,
    _readBuffer: WebGLRenderTarget,
    _deltaTime: number,
    _maskActive: boolean
  ): void {
    this.renderPass(renderer);
  }

  abstract renderPass(renderer: WebGLRenderer): void;
}
