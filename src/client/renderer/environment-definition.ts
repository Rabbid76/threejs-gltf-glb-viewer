import type { LightSource } from './light-source-detection';
import {
  EnvironmentMapDecodeMaterial,
  LightSourceDetector,
} from './light-source-detection';
import { LightSourceDetectorDebug } from './light-source-detection-debug';
import { EnvironmentPmremGenertor } from './pmrem-environment';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { CubeTexture, Scene, Texture, Vector2 } from 'three';

export class EnvironmentDefinition {
  public needsUpdate = true;
  public readonly environmentScene?: Scene;
  public readonly equirectangularTexture?: Texture;
  public readonly cubeTexture?: CubeTexture;
  public readonly textureData?: any;
  private _rotation;
  private _intensity;
  private _lightSources: LightSource[] = [];
  private _debugScene?: Scene;

  get lightSources(): LightSource[] {
    return this._lightSources;
  }

  set rotation(rotation: number) {
    if (this._rotation !== rotation) {
      this._rotation = rotation;
      this.needsUpdate = true;
    }
  }

  set intensity(intensity: number) {
    if (this._intensity !== intensity) {
      this._intensity = intensity;
      this.needsUpdate = true;
    }
  }

  constructor(environment: Scene | CubeTexture | Texture, parameters?: any) {
    if (environment instanceof Scene) {
      this.environmentScene = environment;
    } else if (environment instanceof CubeTexture) {
      this.cubeTexture = environment;
    } else if (environment instanceof Texture) {
      this.equirectangularTexture = environment;
    }
    if (parameters?.textureData) {
      this.textureData = parameters?.textureData;
    }
    this._rotation = parameters?.rotation ?? 0;
    this._intensity = parameters?.intensity ?? 1;
  }

  public createNewEnvironment(renderer: WebGLRenderer): Texture | null {
    const pmremTextue = this._createPmremTexture(renderer);
    const lightSourceDetector = this._detectLightSources(renderer, pmremTextue);
    this._lightSources = lightSourceDetector.lightSources;
    return pmremTextue ?? null;
  }

  private _getTextureOffset(): Vector2 {
    const offestU = (this._rotation / (Math.PI * 2)) % 1;
    return new Vector2(offestU, 0);
  }

  private _createPmremTexture(renderer: WebGLRenderer): Texture | undefined {
    const pmremGenerator = new EnvironmentPmremGenertor(renderer);
    let pmremRenderTarget: WebGLRenderTarget | undefined;
    if (this.equirectangularTexture) {
      this.equirectangularTexture.offset.copy(this._getTextureOffset());
      pmremRenderTarget = pmremGenerator.fromEquirectangularTexture(
        this.equirectangularTexture,
        {
          rotation: this._rotation,
          intensity: this._intensity,
        },
      );
    } else if (this.cubeTexture) {
      pmremRenderTarget = pmremGenerator.fromCubemap(this.cubeTexture);
    } else if (this.environmentScene) {
      this.environmentScene.rotation.y = this._rotation;
      pmremRenderTarget = pmremGenerator.fromScene(this.environmentScene, 0.04);
    }
    this._debugScene = undefined;
    this.needsUpdate = false;
    return pmremRenderTarget?.texture;
  }

  private _detectLightSources(
    renderer: WebGLRenderer,
    pmremTexture?: Texture,
  ): LightSourceDetector {
    const lightSourceDetector = new LightSourceDetector();
    if (this.equirectangularTexture && this.rotation === 0) {
      lightSourceDetector.detectLightSources(
        renderer,
        this.equirectangularTexture,
        this.textureData,
      );
    } else if (pmremTexture) {
      lightSourceDetector.detectLightSources(renderer, pmremTexture);
    }
    return lightSourceDetector;
  }

  public createDebugScene(renderer: WebGLRenderer, scene: Scene): Scene | null {
    if (this._debugScene) {
      return this._debugScene;
    }
    this._debugScene = new Scene();
    const planeMaterial = new EnvironmentMapDecodeMaterial(true, false);
    planeMaterial.setSourceTexture(scene.environment as Texture);
    LightSourceDetectorDebug.createPlane(this._debugScene, planeMaterial);
    const lightSourceDetector = this._detectLightSources(
      renderer,
      scene.environment as Texture,
    );
    const lightSourceDetectorDebug = new LightSourceDetectorDebug(
      lightSourceDetector,
    );
    lightSourceDetectorDebug.createDebugScene(this._debugScene);
    return this._debugScene;
  }
}
