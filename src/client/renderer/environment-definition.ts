import type { LightSource } from './light-source-detection';
import {
  EnvironmentMapDecodeMaterial,
  LightSourceDetector,
} from './light-source-detection';
import { LightSourceDetectorDebug } from './light-source-detection-debug';
import { EnvironmentPmremGenertor } from './pmrem-environment';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { CubeTexture, Scene, Texture, Vector2 } from 'three';

export interface EnvironmentDefinitionTextureData {
  _width: number;
  _height: number;
  data: number[];
}

interface EnvironmentDefinitionParameters {
  textureData?: EnvironmentDefinitionTextureData;
  rotation?: number;
  intensity?: number;
  maxNoOfLightSources?: number;
}

export abstract class EnvironmentSceneGenerator {
  abstract generateScene(intensity: number, rotation: number): Scene;
}

export class EnvironmentDefinition {
  public needsUpdate = true;
  public readonly environmentSceneGenerator?: EnvironmentSceneGenerator;
  public readonly equirectangularTexture?: Texture;
  public readonly cubeTexture?: CubeTexture;
  public readonly textureData?: EnvironmentDefinitionTextureData;
  private _rotation;
  private _intensity;
  private _maxNoOfLightSources?: number;
  private _lightSources: LightSource[] = [];
  private _debugScene?: Scene;
  private _parameters?: EnvironmentDefinitionParameters;
  private _environment: EnvironmentSceneGenerator | CubeTexture | Texture;

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

  set maxNoOfLightSources(maxNoOfLightSources: number) {
    if (this._maxNoOfLightSources !== maxNoOfLightSources) {
      this._maxNoOfLightSources = maxNoOfLightSources;
      this.needsUpdate = true;
    }
  }

  get maxNoOfLightSources(): number | undefined {
    return this._maxNoOfLightSources;
  }

  constructor(
    environment: EnvironmentSceneGenerator | CubeTexture | Texture,
    parameters?: EnvironmentDefinitionParameters
  ) {
    if (environment instanceof EnvironmentSceneGenerator) {
      this.environmentSceneGenerator = environment;
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
    if (parameters?.maxNoOfLightSources !== undefined) {
      this._maxNoOfLightSources = parameters.maxNoOfLightSources;
    }
    this._parameters = parameters;
    this._environment = environment;
  }

  clone() {
    return new EnvironmentDefinition(this._environment, this._parameters);
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
        }
      );
    } else if (this.cubeTexture) {
      pmremRenderTarget = pmremGenerator.fromCubemap(this.cubeTexture);
    } else if (this.environmentSceneGenerator) {
      const environmentScene = this.environmentSceneGenerator.generateScene(
        this._intensity,
        this._rotation
      );
      pmremRenderTarget = pmremGenerator.fromScene(environmentScene, 0.04);
    }
    this._debugScene = undefined;
    this.needsUpdate = false;
    return pmremRenderTarget?.texture;
  }

  private _detectLightSources(
    renderer: WebGLRenderer,
    pmremTexture?: Texture
  ): LightSourceDetector {
    const lightSourceDetector = new LightSourceDetector();
    if (this.equirectangularTexture && this.rotation === 0) {
      lightSourceDetector.detectLightSources(
        renderer,
        this.equirectangularTexture,
        this.textureData
      );
    } else if (pmremTexture) {
      lightSourceDetector.detectLightSources(renderer, pmremTexture);
    }
    return lightSourceDetector;
  }

  public createDebugScene(
    renderer: WebGLRenderer,
    scene: Scene,
    maxNoOfLightSources?: number
  ): Scene | null {
    const maxLightSources = maxNoOfLightSources ?? -1;
    if (
      this._debugScene &&
      maxLightSources === this._debugScene.userData.maximumNumberOfLightSources
    ) {
      return this._debugScene;
    }
    this._debugScene = new Scene();
    const planeMaterial = new EnvironmentMapDecodeMaterial(true, false);
    planeMaterial.setSourceTexture(scene.environment as Texture);
    LightSourceDetectorDebug.createPlane(this._debugScene, planeMaterial);
    const lightSourceDetector = this._detectLightSources(
      renderer,
      scene.environment as Texture
    );
    const lightSourceDetectorDebug = new LightSourceDetectorDebug(
      lightSourceDetector
    );
    lightSourceDetectorDebug.createDebugScene(
      this._debugScene,
      maxLightSources
    );
    this._debugScene.userData.maximumNumberOfLightSources = maxLightSources;
    return this._debugScene;
  }
}
