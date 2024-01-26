import { RenderPass } from './render-pass';
import type { RenderPassManager } from '../render-pass-manager';
import type { WebGLRenderer } from 'three';
import { DoubleSide, MeshStandardMaterial } from 'three';

export class SceneRenderPass extends RenderPass {
  public drawGround: boolean = true;
  public drawWithDebugMaterial = false;
  public grayDebugMaterial = new MeshStandardMaterial({
    color: 0xc0c0c0,
    side: DoubleSide,
    envMapIntensity: 0.4,
  });

  constructor(renderPassManager: RenderPassManager) {
    super(renderPassManager);
  }

  public dispose(): void {
    super.dispose();
    this.grayDebugMaterial.dispose();
  }

  public renderPass(renderer: WebGLRenderer): void {
    this.renderCacheManager.onBeforeRender('floorDepthWrite', this.scene);
    this.renderPassManager.setGroundVisibility(this.drawGround);
    if (this.drawWithDebugMaterial) {
      this.renderCacheManager.render('debug', this.scene, () => {
        this.passRenderer.renderWithOverrideMaterial(
          renderer,
          this.scene,
          this.camera,
          this.grayDebugMaterial,
          null,
          0,
          1
        );
      });
    } else {
      renderer.render(this.scene, this.camera);
    }
    this.renderPassManager.setGroundVisibility(false);
    this.renderCacheManager.onAfterRender('floorDepthWrite');
  }
}
