import { getMaxSamples } from '../renderer/render-utility';
import type { Camera, Scene, WebGLRenderer } from 'three';
import { FramebufferTexture, Vector2 } from 'three';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

interface BloomParameters {
  strength: number;
  radius: number;
  threshold: number;
}

class EffectPass {
  public composer: EffectComposer;
  public pass: Pass;
  public enabled: boolean = false;
  public isEnabled: boolean = false;

  constructor(composer: EffectComposer, pass: Pass) {
    this.composer = composer;
    this.pass = pass;
  }

  public resize(width: number, height: number): void {
    this.pass.setSize(width, height);
  }

  public updateState(allowEnable: boolean) {
    const enable = this.enabled && allowEnable;
    if (enable !== this.isEnabled) {
      if (enable) {
        this.composer.addPass(this.pass);
      } else {
        this.composer.removePass(this.pass);
      }
      this.isEnabled = enable;
    }
  }
}

export class PostProcessingEffects {
  private renderer: WebGLRenderer;
  private colorTexture: FramebufferTexture;
  private width: number;
  private height: number;
  public composer: EffectComposer;
  public maxSamples: number;
  public outlinePassEnabled: boolean = false;
  public ssrPass: EffectPass;
  public bloomPass: EffectPass;
  public fxaaPass: EffectPass;
  public bloomParameter: BloomParameters = {
    strength: 1.5,
    radius: 0.4,
    threshold: 0.85,
  };

  constructor(
    renderer: WebGLRenderer,
    composer: EffectComposer,
    scene: Scene,
    camera: Camera,
    width: number,
    height: number,
    _parameters?: any
  ) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;
    this.maxSamples = getMaxSamples(renderer);
    this.colorTexture = new FramebufferTexture(this.width, this.height);
    this.composer = composer;

    const bloomPass = new UnrealBloomPass(
      new Vector2(width, height),
      this.bloomParameter.strength,
      this.bloomParameter.radius,
      this.bloomParameter.threshold
    );
    this.bloomPass = new EffectPass(this.composer, bloomPass);

    this.ssrPass = new EffectPass(
      this.composer,
      new SSRPass({
        renderer,
        scene,
        camera,
        width: innerWidth,
        height: innerHeight,
        groundReflector: null,
        selects: null,
      })
    );

    const fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass = new EffectPass(this.composer, fxaaPass);
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.composer.setSize(width, height);
    this.fxaaPass.resize(width, height);
    this.ssrPass.resize(width, height);
    this.bloomPass.resize(width, height);
    this.colorTexture.dispose();
    this.colorTexture = new FramebufferTexture(this.width, this.height);
  }

  public setFxaa(enabled: boolean) {
    this.fxaaPass.enabled = enabled;
    this.updateFxaa();
    if (this.fxaaPass.isEnabled) {
      const pixelRatio = this.renderer.getPixelRatio();
      // @ts-ignore
      this.fxaaPass.material.uniforms.resolution.value.x =
        1 / (this.width * pixelRatio);
      // @ts-ignore
      this.fxaaPass.material.uniforms.resolution.value.y =
        1 / (this.height * pixelRatio);
    }
  }

  public setBloom(enabled: boolean) {
    this.bloomPass.enabled = enabled;
    this.updateBloom();
  }

  public setSSR(enabled: boolean) {
    const bloomIsEnabled = this.bloomPass.isEnabled;
    if (bloomIsEnabled) {
      this.setBloom(false);
    }
    this.ssrPass.enabled = enabled;
    this.updateSSR();
    if (bloomIsEnabled) {
      this.setBloom(true);
    }
  }

  public anyPostProcess(): boolean {
    return this.bloomPass.enabled || this.ssrPass.enabled;
  }

  public render(): void {
    if (this.anyPostProcess()) {
      this.composer.render();
    }
  }

  public setDebugEffect(_effect: string) {
    this.updateFxaa();
    this.updateBloom();
    this.updateSSR();
  }

  private updateFxaa() {
    this.fxaaPass.updateState(true);
  }

  private updateBloom() {
    this.bloomPass.updateState(true);
  }

  private updateSSR() {
    this.ssrPass.updateState(true);
  }
}
