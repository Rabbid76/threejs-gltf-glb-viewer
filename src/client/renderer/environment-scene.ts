import { EnvironmentSceneGenerator } from './environment-definition';
import type { BufferGeometry, Material } from 'three';
import {
  AmbientLight,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector2,
} from 'three';

type Enumify<T> = T[keyof T];

export const DefaultEnvironmentScenes = {
  FRONT: 'front',
  ALL_AROUND: 'all_around',
} as const;

export type DefaultEnvironmentSceneType = Enumify<
  typeof DefaultEnvironmentScenes
> | null;

export interface DefaultEnvironmentSceneParameters {
  type?: DefaultEnvironmentSceneType;
  lightIntensity?: number;
  topLightIntensity?: number;
  sidLightIntensity?: number;
  ambientLightIntensity?: number;
  colorVariation?: number;
}

export class DefaultEnvironmentSceneGenerator extends EnvironmentSceneGenerator {
  private _parameters: DefaultEnvironmentSceneParameters = {};

  public constructor(parameters: DefaultEnvironmentSceneParameters = {}) {
    super();
    this._parameters = parameters;
  }

  public generateScene(intensity: number, rotation: number): Scene {
    const defaultEnvironmentScene = new DefaultEnvironmentScene({
      ...this._parameters,
      lightIntensity: intensity * (this._parameters.lightIntensity || 1.0),
      topLightIntensity:
        intensity * (this._parameters.topLightIntensity || 1.0),
      sidLightIntensity:
        intensity * (this._parameters.sidLightIntensity || 1.0),
    });
    defaultEnvironmentScene.rotation.y = rotation;
    return defaultEnvironmentScene;
  }
}

export class DefaultEnvironmentScene extends Scene {
  private _type: DefaultEnvironmentSceneType;
  private _topLightIntensity: number;
  private _sideLightIntensity: number;
  private _sideReflectorIntensity: number;
  private _ambientLightIntensity: number;
  private _colorVariation: number;
  private _lightGeometry: BufferGeometry;

  constructor(parameters: DefaultEnvironmentSceneParameters = {}) {
    super();
    this._type = parameters?.type ?? DefaultEnvironmentScenes.ALL_AROUND;
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
    switch (this._type) {
      default:
      case DefaultEnvironmentScenes.ALL_AROUND:
        this._createAllAroundSceneLight(scene);
        break;
      case DefaultEnvironmentScenes.FRONT:
        this._createFrontSceneLight(scene);
        break;
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
    for (const resource of resources) {
      (resource as BufferGeometry | Material).dispose();
    }
  }

  private _createAllAroundSceneLight(scene: Scene) {
    const ambientLight = new AmbientLight(0xffffff);
    ambientLight.intensity = this._ambientLightIntensity;
    this.add(ambientLight);
    this._createTopLight(scene, 6, 1);
    for (let i = 0; i < 6; i++) {
      const azimuthAngleInRad = (i * Math.PI * 2.0) / 6.0;
      const x = Math.sin(azimuthAngleInRad);
      const z = Math.cos(azimuthAngleInRad);
      if (i % 2 === 0) {
        this._createReflector(scene, new Vector2(x, z), 3, 1, 1);
      } else {
        this._createSideLight(
          scene,
          new Vector2(x, z),
          (i - 1) / 2,
          15,
          1.1,
          0.33
        );
      }
    }
  }

  private _createFrontSceneLight(scene: Scene) {
    const ambientLight = new AmbientLight(0xffffff);
    ambientLight.intensity = this._ambientLightIntensity;
    this.add(ambientLight);
    this._createTopLight(scene, 5, 0.9);
    for (let i = 0; i < 6; i++) {
      const azimuthAngleInRad = (i * Math.PI * 2.0) / 6.0;
      const x = Math.sin(azimuthAngleInRad);
      const z = Math.cos(azimuthAngleInRad);
      if (i === 0) {
        this._createReflector(scene, new Vector2(x, z), 3, 0.8, 0.4);
        for (let j = 0; j < 2; j++) {
          const tangentialAngleInRad =
            ((i - 0.2 + j * 0.4) * Math.PI * 2.0) / 6.0;
          const x0 = Math.sin(tangentialAngleInRad);
          const z0 = Math.cos(tangentialAngleInRad);
          this._createSideLight(
            scene,
            new Vector2(x0, z0),
            (i - 1) / 2,
            20,
            1.1,
            0.75
          );
        }
      } else {
        this._createReflector(scene, new Vector2(x, z), 3, 0.8, 1);
      }
    }
  }

  private _createAreaLightMaterial(r: number, g?: number, b?: number) {
    const material = new MeshBasicMaterial();
    material.color.set(r, g ?? r, b ?? r);
    return material;
  }

  private _createTopLight(scene: Scene, intensity: number, scale: number) {
    const topLight = new Mesh(
      this._lightGeometry,
      this._createAreaLightMaterial(intensity * this._topLightIntensity)
    );
    topLight.position.set(0.0, 20.0, 0.0);
    topLight.scale.set(5 * scale, 0.1, 5 * scale);
    scene.add(topLight);
  }

  private _createSideLight(
    scene: Scene,
    direction: Vector2,
    index: number,
    intensity: number,
    scale: number,
    level: number
  ) {
    for (let j = 0; j < 3; j++) {
      const li = intensity * this._sideLightIntensity;
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
        direction.x * 15.0 + xOffset * 1.1 * scale,
        level * 15.0 + yOffset * 1.1 * scale,
        direction.y * 15.0 + zOffset * 1.1 * scale
      );
      light.rotation.set(0, Math.atan2(direction.x, direction.y), 0);
      light.scale.setScalar(scale);
      scene.add(light);
    }
  }

  private _createReflector(
    scene: Scene,
    direction: Vector2,
    intensity: number,
    scale: number,
    scaleZ: number
  ) {
    const light = new Mesh(
      this._lightGeometry,
      this._createAreaLightMaterial(intensity * this._sideReflectorIntensity)
    );
    light.position.set(direction.x * 15.0, 5.0 * scaleZ, direction.y * 15.0);
    light.rotation.set(0, Math.atan2(direction.x, direction.y), 0);
    light.scale.set(10 * scale, 12 * scale * scaleZ, 10 * scale);
    scene.add(light);
  }
}
