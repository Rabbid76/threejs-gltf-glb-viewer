import { EnvironmentSceneGenerator } from './environment-definition';
import type { BufferGeometry } from 'three';
import {
  AmbientLight,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector2,
} from 'three';

export class DefaultEnvironmentSceneGenerator extends EnvironmentSceneGenerator {
  public generateScene(intensity: number, rotation: number): Scene {
    const defaultEnvironmentScene = new DefaultEnvironmentScene({
      lightIntensity: intensity,
    });
    defaultEnvironmentScene.rotation.y = rotation;
    return defaultEnvironmentScene;
  }
}

export interface DefaultEnvironmentSceneParameters {
  lightIntensity?: number;
  topLightIntensity?: number;
  sidLightIntensity?: number;
  ambientLightIntensity?: number;
  colorVariation?: number;
}

export class DefaultEnvironmentScene extends Scene {
  private _topLightIntensity: number;
  private _sideLightIntensity: number;
  private _sideReflectorIntensity: number;
  private _ambientLightIntensity: number;
  private _colorVariation: number;
  private _lightGeometry: BufferGeometry;

  constructor(parameters?: DefaultEnvironmentSceneParameters) {
    super();
    this._topLightIntensity =
      parameters?.topLightIntensity || parameters?.lightIntensity || 1.0;
    this._sideLightIntensity =
      parameters?.sidLightIntensity || parameters?.lightIntensity || 1.0;
    this._sideReflectorIntensity =
      parameters?.sidLightIntensity || parameters?.lightIntensity || 1.0;
    this._ambientLightIntensity = parameters?.ambientLightIntensity || 0.25;
    this._colorVariation = parameters?.colorVariation || 0.5;
    this._lightGeometry = new BoxGeometry();
    this._lightGeometry.deleteAttribute('uv');
    this.generateScene(this);
  }

  public generateScene(scene: Scene) {
    const ambientLight = new AmbientLight(0xffffff);
    ambientLight.intensity = this._ambientLightIntensity;
    this.add(ambientLight);

    this._createTopLight(scene);

    for (let i = 0; i < 6; i++) {
      const x = Math.sin((i * Math.PI * 2.0) / 6.0);
      const z = Math.cos((i * Math.PI * 2.0) / 6.0);
      if (i % 2 === 0) {
        this._createReflector(scene, new Vector2(x, z));
      } else {
        this._createSideLight(scene, new Vector2(x, z), (i - 1) / 2);
      }
    }
  }

  dispose() {
    const resources = new Set();
    this.traverse((object: any) => {
      if (object.isMesh) {
        resources.add(object.geometry);
        resources.add(object.material);
      }
    });
    resources.forEach((resource: any) => resource.dispose());
  }

  private _createAreaLightMaterial(r: number, g?: number, b?: number) {
    const material = new MeshBasicMaterial();
    material.color.set(r, g ?? r, b ?? r);
    return material;
  }

  private _createTopLight(scene: Scene) {
    const topLight = new Mesh(
      this._lightGeometry,
      this._createAreaLightMaterial(6 * this._topLightIntensity)
    );
    topLight.position.set(0.0, 20.0, 0.0);
    topLight.scale.set(5.0, 0.1, 5.0);
    scene.add(topLight);
  }

  private _createSideLight(scene: Scene, direction: Vector2, index: number) {
    for (let j = 0; j < 3; j++) {
      const li = 15 * this._sideLightIntensity;
      const light = new Mesh(
        this._lightGeometry,
        this._createAreaLightMaterial(
          (j + index) % 3 === 0 ? li : li * (1.0 - this._colorVariation),
          (j + index) % 3 === 1 ? li : li * (1.0 - this._colorVariation),
          (j + index) % 3 === 2 ? li : li * (1.0 - this._colorVariation)
        )
      );
      const xOffset =
        (j === 1 ? -direction.y : j === 2 ? direction.y : 0) / Math.sqrt(2);
      const yOffset = j === 0 ? 0 : 1;
      const zOffset =
        (j === 1 ? direction.x : j === 2 ? -direction.x : 0) / Math.sqrt(2);
      light.position.set(
        direction.x * 15.0 + xOffset * 1.2,
        5.0 + yOffset * 1.2,
        direction.y * 15.0 + zOffset * 1.2
      );
      light.rotation.set(0, Math.atan2(direction.x, direction.y), 0);
      light.scale.set(1.1, 1.1, 1.1);
      scene.add(light);
    }
  }

  private _createReflector(scene: Scene, direction: Vector2) {
    const light = new Mesh(
      this._lightGeometry,
      this._createAreaLightMaterial(3 * this._sideReflectorIntensity)
    );
    light.position.set(direction.x * 15.0, 5.0, direction.y * 15.0);
    light.rotation.set(0, Math.atan2(direction.x, direction.y), 0);
    light.scale.set(10, 12, 10);
    scene.add(light);
  }
}
