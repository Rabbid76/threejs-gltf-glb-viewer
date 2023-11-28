import { RectAreaLightHelper } from 'three/examples/jsm/helpers/RectAreaLightHelper.js';
import type { SceneVolume } from './render-utility';
import { CameraUpdate, RenderPass } from './render-utility';
import type { LightSource } from './light-source-detection';
import type { RenderCacheManager } from './render-cache';
import { ObjectRenderCache } from './render-cache';
import { IlluminationBufferMaterial } from './materials/illumination-buffer-material';
import type {
  Box3,
  Camera,
  Layers,
  Light,
  Material,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  RectAreaLight,
  Scene,
  ShadowMapType,
  Texture,
  WebGLRenderer,
  Mesh,
} from 'three';
import {
  BasicShadowMap,
  DirectionalLight,
  DoubleSide,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PCFSoftShadowMap,
  RedFormat,
  ShadowMaterial,
  SpotLight,
  Vector2,
  Vector3,
  VSMShadowMap,
  WebGLRenderTarget,
} from 'three';

export enum ShadowLightSourceType {
  DirectionalLightShadow,
  SpotLightShadow,
}

export interface ScreenSpaceShadowMapParameters {
  [key: string]: any;
  alwaysUpdate: boolean;
  enableShadowMap: boolean;
  layers: Layers | null;
  shadowLightSourceType: ShadowLightSourceType;
  maximumNumberOfLightSources: number;
  directionalDependency: number;
  directionalExponent: number;
  groundContainment: number;
  fadeOutDistance: number;
  fadeOutBlur: number;
}

export const defaultScreenSpaceShadowMapParameters: ScreenSpaceShadowMapParameters =
  {
    alwaysUpdate: false,
    enableShadowMap: true,
    layers: null,
    shadowLightSourceType: ShadowLightSourceType.DirectionalLightShadow,
    maximumNumberOfLightSources: -1,
    directionalDependency: 1.0,
    directionalExponent: 1.0,
    groundContainment: 1.0,
    fadeOutDistance: 0.1,
    fadeOutBlur: 20.0,
  };

interface ActiveShadowLight {
  light: Light;
  intensity: number;
}

export interface ShadowLightSource {
  getPosition(): Vector3;
  getShadowLight(): Light;
  getOriginalLight(): Light | null;
  dispose(): void;
  addTo(object: Object3D): void;
  removeFrom(object: Object3D): void;
  updatePositionAndTarget(): void;
  updateBounds(sceneBounds: SceneVolume): void;
  forceShadowUpdate(): void;
  _updateShadowType(
    typeParameters: ShadowTypeParameters,
    shadowScale: number
  ): void;
  prepareRenderShadow(): ActiveShadowLight[];
  finishRenderShadow(): void;
}

export interface ScreenSpaceShadowMapConstructorParameters {
  samples?: number;
  shadowMapSize?: number;
  alwaysUpdate?: boolean;
  enableShadowMap?: boolean;
  layers?: Layers | null;
  shadowLightSourceType?: ShadowLightSourceType;
  maximumNumberOfLightSources?: number;
  directionalDependency?: number;
  directionalExponent?: number;
  groundContainment?: number;
  fadeOutDistance?: number;
  fadeOutBlur?: number;
}

export class ScreenSpaceShadowMap {
  public parameters: ScreenSpaceShadowMapParameters;
  public needsUpdate: boolean = false;
  public shadowTypeNeedsUpdate: boolean = true;
  public shadowConfiguration = new ShadowTypeConfiguration();
  private _shadowLightSources: ShadowLightSource[] = [];
  private _renderCacheManager: RenderCacheManager;
  private _shadowMapPassOverrideMaterialCache: ShadowMapPassOverrideMaterialCache;
  private _viewportSize: Vector2;
  private _samples: number;
  private _shadowScale: number = 1;
  private _shadowMapSize: number;
  public castShadow: boolean;
  private _shadowRenderTarget: WebGLRenderTarget;
  private _renderPass = new RenderPass();
  private _cameraUpdate: CameraUpdate = new CameraUpdate();

  public get shadowTexture(): Texture {
    return this._shadowRenderTarget.texture;
  }

  public set shadowOnGround(value: boolean) {
    this._shadowMapPassOverrideMaterialCache.shadowOnGround = value;
  }

  constructor(
    renderCacheManager: RenderCacheManager,
    viewportSize: Vector2,
    parameters: ScreenSpaceShadowMapConstructorParameters
  ) {
    this._renderCacheManager = renderCacheManager;
    this._viewportSize = new Vector2(viewportSize.x, viewportSize.y);
    this._samples = parameters?.samples ?? 0;
    this._shadowMapSize = parameters?.shadowMapSize ?? 1024;
    this.parameters = this._getScreenSpaceShadowMapParameters(parameters);
    this.castShadow = this.parameters.enableShadowMap;
    this._shadowMapPassOverrideMaterialCache =
      new ShadowMapPassOverrideMaterialCache();
    this._renderCacheManager.registerCache(
      this,
      this._shadowMapPassOverrideMaterialCache
    );
    const samples = this._samples;
    this._shadowRenderTarget = new WebGLRenderTarget(
      this._viewportSize.x,
      this._viewportSize.y,
      { samples, format: RedFormat }
    );
  }

  private _getScreenSpaceShadowMapParameters(
    parameters?: ScreenSpaceShadowMapConstructorParameters
  ): ScreenSpaceShadowMapParameters {
    return {
      ...defaultScreenSpaceShadowMapParameters,
      ...parameters,
    };
  }

  public dispose(): void {
    this._shadowLightSources.forEach((item) => item.dispose());
    this._shadowRenderTarget.dispose();
    this._shadowMapPassOverrideMaterialCache.dispose();
  }

  public updateParameters(parameters: ScreenSpaceShadowMapParameters) {
    for (let propertyName in parameters) {
      if (this.parameters.hasOwnProperty(propertyName)) {
        this.parameters[propertyName] = parameters[propertyName];
      }
    }
  }

  public updateBounds(sceneBounds: SceneVolume, scaleShadow: number) {
    const currentScale = this._shadowScale;
    this._shadowScale = scaleShadow;
    if (Math.abs(currentScale - this._shadowScale) > 0.00001) {
      this.shadowTypeNeedsUpdate = true;
    }
    this._shadowLightSources.forEach((item) => item.updateBounds(sceneBounds));
    this._shadowMapPassOverrideMaterialCache.setBoundingBox(sceneBounds.bounds);
  }

  public forceShadowUpdate() {
    this._shadowLightSources.forEach((item) => item.forceShadowUpdate());
    this.needsUpdate = true;
  }

  public getShadowLightSources(): Light[] {
    const lightSources: Light[] = this._shadowLightSources.map((item) =>
      item.getShadowLight()
    );
    return lightSources;
  }

  public findShadowLightSource(lightSource: Light): Light | undefined {
    return this._shadowLightSources
      .find((item) => item.getOriginalLight() === lightSource)
      ?.getShadowLight();
  }

  public addRectAreaLight(
    rectAreaLight: RectAreaLight,
    parent: Object3D
  ): void {
    const rectAreaLightShadow = new RectAreaShadowLightSource(rectAreaLight, {
      shadowMapSize: this._shadowMapSize,
      shadowLightSourceType: this.parameters.shadowLightSourceType,
    });
    this._shadowLightSources.push(rectAreaLightShadow);
    rectAreaLightShadow.addTo(parent);
    rectAreaLightShadow.updatePositionAndTarget();
    this.needsUpdate = true;
  }

  public updateRectAreaLights(
    rectAreaLights: RectAreaLight[],
    parent: Object3D
  ): void {
    this._shadowLightSources = this._shadowLightSources.filter((item) => {
      if (item instanceof RectAreaShadowLightSource) {
        const light = item.getRectAreaLight();
        if (rectAreaLights.includes(light)) {
          item.updatePositionAndTarget();
          return true;
        }
      }
      item.removeFrom(parent);
      item.dispose();
      return false;
    });
    rectAreaLights.forEach((light) => {
      if (
        !this._shadowLightSources.find(
          (item) =>
            item instanceof RectAreaShadowLightSource &&
            item.getRectAreaLight() === light
        )
      ) {
        this.addRectAreaLight(light, parent);
      }
    });
    this.needsUpdate = true;
    this.shadowTypeNeedsUpdate = true;
  }

  public createShadowFromLightSources(
    parent: Object3D,
    lightSources: LightSource[]
  ): void {
    this._shadowLightSources = this._shadowLightSources.filter((item) => {
      item.removeFrom(parent);
      item.dispose();
    });
    const maxIntensity =
      lightSources.length > 0
        ? Math.max(
            ...lightSources.map(
              (lightSource: LightSource) => lightSource.maxIntensity
            )
          )
        : 1;
    const lightIntensityScale = 1 / maxIntensity;
    this._addShadowFromLightSources(lightSources, lightIntensityScale);
    this._shadowLightSources.forEach((item) => {
      item.addTo(parent);
      item.updatePositionAndTarget();
    });
    this.needsUpdate = true;
    this.shadowTypeNeedsUpdate = true;
  }

  private _addShadowFromLightSources(
    lightSources: LightSource[],
    lightIntensityScale: number
  ): void {
    const lightIntensityThreshold = 0.1;
    const lightDistanceScale = 7;
    lightSources.forEach((lightSource) => {
      const lightIntensity = lightSource.maxIntensity * lightIntensityScale;
      if (
        lightIntensity >= lightIntensityThreshold &&
        lightSource.position.z >= 0
      ) {
        const lightPosition = new Vector3(
          lightSource.position.x,
          lightSource.position.z,
          lightSource.position.y
        ).multiplyScalar(lightDistanceScale);
        const environmentLightShadow = new EnvironmentShadowLightSource(
          lightPosition,
          lightIntensity,
          {
            shadowMapSize: this._shadowMapSize,
            shadowLightSourceType: this.parameters.shadowLightSourceType,
          }
        );
        this._shadowLightSources.push(environmentLightShadow);
      }
    });
  }

  public setSize(width: number, height: number): void {
    this._viewportSize = new Vector2(width, height);
    this._shadowRenderTarget.setSize(
      this._viewportSize.x,
      this._viewportSize.y
    );
  }

  public updatePositionAndTarget(): void {
    this._shadowLightSources.forEach((item) => item.updatePositionAndTarget());
  }

  public renderShadowMap(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera
  ): void {
    const needsUpdate =
      this.needsUpdate ||
      this.parameters.alwaysUpdate ||
      this._cameraUpdate.changed(camera);
    if (!needsUpdate) {
      return;
    }
    this.needsUpdate = false;
    if (this.shadowTypeNeedsUpdate) {
      this.shadowTypeNeedsUpdate = false;
      this.needsUpdate = true;
      this._updateShadowType(renderer);
    }

    const sceneBackground = scene.background;
    const sceneEnvironment = scene.environment;
    const layersMaskBackup = camera.layers.mask;
    scene.environment = null;
    scene.background = null;
    if (this.parameters.layers) {
      camera.layers.mask = this.parameters.layers.mask;
    }
    this._renderSimpleShadowMapFromShadowLightSources(renderer, scene, camera);
    camera.layers.mask = layersMaskBackup;
    scene.environment = sceneEnvironment;
    scene.background = sceneBackground;
  }

  private _renderSimpleShadowMapFromShadowLightSources(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera
  ) {
    this._shadowMapPassOverrideMaterialCache.setShadowParameters(
      this.parameters.directionalDependency,
      this.parameters.directionalExponent,
      this.parameters.groundContainment,
      this.parameters.fadeOutDistance * this._shadowScale,
      this.parameters.fadeOutBlur
    );
    const activeShadowLights = this._getSortedShadowLightSources();
    if (activeShadowLights.length === 0) {
      this._renderPass.clear(renderer, this._shadowRenderTarget, 0xffffff, 1);
    } else {
      this._setShadowLightSourcesIntensity(activeShadowLights);
      this._renderCacheManager.render(this, scene, () => {
        this._renderPass.render(
          renderer,
          scene,
          camera,
          this._shadowRenderTarget,
          0xffffff,
          1
        );
      });
      this._shadowLightSources.forEach((item) => item.finishRenderShadow());
    }
  }

  private _getSortedShadowLightSources(): ActiveShadowLight[] {
    let activeShadowLights: ActiveShadowLight[] = [];
    this._shadowLightSources.forEach((item) =>
      activeShadowLights.push(...item.prepareRenderShadow())
    );
    activeShadowLights.sort((a, b) => {
      if (a.light.castShadow && !b.light.castShadow) {
        return -1;
      }
      if (!a.light.castShadow && b.light.castShadow) {
        return 1;
      }
      return b.intensity - a.intensity;
    });
    return activeShadowLights;
  }

  private _setShadowLightSourcesIntensity(
    activeShadowLights: ActiveShadowLight[]
  ) {
    let sumOfShadowLightIntensity = 0;
    for (let i = 0; i < activeShadowLights.length; i++) {
      const shadowLight = activeShadowLights[i];
      if (
        this.parameters.maximumNumberOfLightSources < 0 ||
        i < this.parameters.maximumNumberOfLightSources
      ) {
        sumOfShadowLightIntensity += shadowLight.intensity;
      }
    }
    for (let i = 0; i < activeShadowLights.length; i++) {
      const shadowLight = activeShadowLights[i];
      if (
        this.parameters.maximumNumberOfLightSources < 0 ||
        i < this.parameters.maximumNumberOfLightSources
      ) {
        shadowLight.light.visible = true;
        shadowLight.light.intensity =
          shadowLight.intensity / sumOfShadowLightIntensity;
        shadowLight.light.castShadow &&= this.castShadow;
      } else {
        shadowLight.light.visible = false;
        shadowLight.light.intensity = 0;
        shadowLight.light.castShadow = false;
      }
    }
  }

  private _updateShadowType(renderer: WebGLRenderer): void {
    renderer.shadowMap.type =
      this.shadowConfiguration.currentConfiguration.type;
    const castShadow =
      this.parameters.enableShadowMap &&
      this.shadowConfiguration.currentConfiguration.castShadow;
    renderer.shadowMap.enabled = castShadow;
    renderer.shadowMap.needsUpdate = true;
    this.castShadow =
      castShadow && this.shadowConfiguration.currentConfiguration.castShadow;
    this._shadowLightSources.forEach((item) =>
      item._updateShadowType(
        this.shadowConfiguration.currentConfiguration,
        this._shadowScale
      )
    );
  }

  public switchType(type: string): boolean {
    if (!this.shadowConfiguration.switchType(type)) {
      return false;
    }
    this.needsUpdate = true;
    this.shadowTypeNeedsUpdate = true;
    return true;
  }
}

enum ShadowMaterialType {
  Default,
  Unlit,
  Emissive,
  Shadow,
}

export class ShadowMapPassOverrideMaterialCache extends ObjectRenderCache {
  static useModifiedMaterial: boolean = true;
  private _shadowObjectMaterial: Material;
  private _unlitMaterial: Material;
  private _emissiveMaterial: Material;
  private _receiveShadowMaterial: Material;
  private _boundingBoxSet: boolean = false;
  private _shadowOnGround: boolean = true;

  public set shadowOnGround(value: boolean) {
    this._shadowOnGround = value;
  }

  constructor() {
    super();
    this._shadowObjectMaterial = this._createShadowMaterial(
      ShadowMaterialType.Default
    );
    this._unlitMaterial = this._createShadowMaterial(ShadowMaterialType.Unlit);
    this._emissiveMaterial = this._createShadowMaterial(
      ShadowMaterialType.Emissive
    );
    this._receiveShadowMaterial = this._createShadowMaterial(
      ShadowMaterialType.Shadow
    );
  }

  public dispose(): void {
    this._shadowObjectMaterial.dispose();
    this._unlitMaterial.dispose();
    this._emissiveMaterial.dispose();
    this._receiveShadowMaterial.dispose();
  }

  public setShadowParameters(
    directionalDependency: number,
    directionalExponent: number,
    groundContainment: number,
    distance: number,
    blur: number
  ) {
    IlluminationBufferMaterial.setShadowParameters(
      directionalDependency,
      directionalExponent,
      groundContainment,
      distance,
      blur
    );
  }

  public setBoundingBox(box: Box3) {
    this._boundingBoxSet = true;
    IlluminationBufferMaterial.setBoundingBox(box);
  }

  private _createShadowMaterial(type: ShadowMaterialType): Material {
    let material: Material;
    if (type === ShadowMaterialType.Emissive) {
      material = new MeshBasicMaterial({
        color: 0xffffff,
        side: DoubleSide,
      });
    } else if (type === ShadowMaterialType.Unlit) {
      material = new MeshBasicMaterial({
        color: 0xffffff,
        side: DoubleSide,
      });
    } else if (type === ShadowMaterialType.Shadow) {
      material = new ShadowMaterial({
        side: DoubleSide,
      });
    } else if (ShadowMapPassOverrideMaterialCache.useModifiedMaterial) {
      material = this._createCustomerShadowMaterial();
    } else {
      material = new MeshPhongMaterial({
        color: 0xffffff,
        shininess: 0,
        polygonOffsetFactor: 0,
        polygonOffsetUnits: 0,
        side: DoubleSide,
      });
    }
    return material;
  }

  private _createCustomerShadowMaterial(): Material {
    const material = new IlluminationBufferMaterial({
      side: DoubleSide,
    });
    return material;
  }

  public addLineOrPoint(object3d: Object3D): void {
    this.addToCache(object3d, { visible: false });
  }

  public addMesh(mesh: Mesh): void {
    if (mesh.visible) {
      this._setMeshMaterialAndVisibility(mesh);
    }
  }

  public addObject(object3d: Object3D): void {
    if ((object3d as any).isLight && !object3d.userData.shadowLightSource) {
      this.addToCache(object3d, { visible: false });
    }
  }

  private _setMeshMaterialAndVisibility(object: Mesh) {
    if (object.userData.isFloor) {
      this._setMeshShadowFloorMaterial(object);
    } else if (
      object.material &&
      object.receiveShadow &&
      !Array.isArray(object.material) &&
      !(object.material.transparent === true && object.material.opacity < 0.9)
    ) {
      this._setShadowMaterialForOpaqueObject(object);
    } else if (
      object.material &&
      (object.material as Material).transparent &&
      (object.material as Material).opacity < 0.9
    ) {
      this.addToCache(object, { visible: false });
    } else if (object.receiveShadow) {
      this.addToCache(object, {
        castShadow: false,
        material: this._receiveShadowMaterial,
      });
    } else {
      this.addToCache(object, { visible: false });
    }
  }

  private _setShadowMaterialForOpaqueObject(object: Mesh) {
    const material = object.material;
    if (
      material instanceof LineBasicMaterial ||
      material instanceof MeshBasicMaterial
    ) {
      this.addToCache(object, { material: this._unlitMaterial });
    } else if (material instanceof MeshStandardMaterial) {
      this._setMeshShadowStandardMaterial(object, material);
    } else {
      this.addToCache(object, {
        material: object.receiveShadow
          ? this._shadowObjectMaterial
          : this._unlitMaterial,
      });
    }
  }

  private _setMeshShadowStandardMaterial(
    object: Mesh,
    material: MeshStandardMaterial
  ) {
    const isEmissive =
      material.emissiveIntensity > 0 &&
      (material.emissive.r > 0 ||
        material.emissive.g > 0 ||
        material.emissive.b > 0);
    this.addToCache(object, {
      castShadow: isEmissive ? false : object.castShadow,
      material: isEmissive
        ? this._emissiveMaterial
        : object.receiveShadow
          ? this._shadowObjectMaterial
          : this._unlitMaterial,
    });
  }

  private _setMeshShadowFloorMaterial(object: Mesh) {
    if (this._boundingBoxSet && this._shadowOnGround) {
      this.addToCache(object, {
        visible: true,
        castShadow: false,
        receiveShadow: true,
        material: this._shadowObjectMaterial,
      });
    } else {
      this.addToCache(object, { visible: false });
    }
  }
}

export interface ShadowTypeParameters {
  castShadow: boolean;
  type: ShadowMapType;
  bias: number;
  normalBias: number;
  radius: number;
}

export class ShadowTypeConfiguration {
  // see LightShadow - https://threejs.org/docs/#api/en/lights/shadows/LightShadow
  // bias: Shadow map bias, how much to add or subtract from the normalized depth when deciding whether a surface is in shadow.
  //       This value depends on the normalized depth and must not be scaled with the size of the scene.
  // normalBias: Defines how much the _position used to query the shadow map is offset along the object normal.
  //       This value is in world space units and must be scaled with the size of the scene.
  private static _noShadow: ShadowTypeParameters = {
    castShadow: false,
    type: PCFShadowMap,
    bias: 0,
    normalBias: 0,
    radius: 0,
  };
  private static _basicShadow: ShadowTypeParameters = {
    castShadow: true,
    type: BasicShadowMap,
    bias: -0.00005,
    normalBias: 0.005,
    radius: 0,
  };
  private static _pcfShadow: ShadowTypeParameters = {
    castShadow: true,
    type: PCFShadowMap,
    bias: -0.00005, // -0.0002,
    normalBias: 0.01,
    radius: 4,
  };
  private static _pcfSoftShadow: ShadowTypeParameters = {
    castShadow: true,
    type: PCFSoftShadowMap,
    bias: -0.00005,
    normalBias: 0.01,
    radius: 1,
  };
  private static _vcmShadow: ShadowTypeParameters = {
    castShadow: true,
    type: VSMShadowMap,
    bias: 0.0001,
    normalBias: 0,
    radius: 15,
  };
  public types = new Map<string, ShadowTypeParameters>([
    ['off', ShadowTypeConfiguration._noShadow],
    ['BasicShadowMap', ShadowTypeConfiguration._basicShadow],
    ['PCFShadowMap', ShadowTypeConfiguration._pcfShadow],
    ['PCFSoftShadowMap', ShadowTypeConfiguration._pcfSoftShadow],
    ['VSMShadowMap', ShadowTypeConfiguration._vcmShadow],
  ]);
  private static _defaultType: ShadowTypeParameters =
    ShadowTypeConfiguration._pcfShadow;
  public shadowType: string = 'PCFShadowMap'; // 'VSMShadowMap'
  public currentConfiguration: ShadowTypeParameters =
    this.types.get(this.shadowType) ?? ShadowTypeConfiguration._defaultType;

  public switchType(type: any): boolean {
    if (!this.types.has(type)) {
      return false;
    }
    this.currentConfiguration =
      this.types.get(type) ?? ShadowTypeConfiguration._defaultType;
    return true;
  }
}

export interface BaseShadowLightSourceParameters {
  shadowMapSize?: number;
  blurSamples?: number;
}

abstract class BaseShadowLightSource implements ShadowLightSource {
  protected _shadowLightSource: Light;
  protected _shadowMapSize: number;
  protected _blurSamples: number;
  protected _isVisibleBackup: boolean = true;
  protected _castShadowBackup: boolean = true;

  constructor(lightSource: Light, parameters: BaseShadowLightSourceParameters) {
    this._shadowMapSize = parameters?.shadowMapSize ?? 1024;
    this._blurSamples = parameters?.blurSamples ?? 8;
    this._shadowLightSource = lightSource;
    this._shadowLightSource.visible = false;
    this._shadowLightSource.castShadow = true;
    if (this._shadowLightSource.shadow) {
      this._shadowLightSource.shadow.mapSize = new Vector2(
        this._shadowMapSize,
        this._shadowMapSize
      );
      this._shadowLightSource.shadow.blurSamples = this._blurSamples;
      this._shadowLightSource.shadow.autoUpdate = false;
    }
    this._shadowLightSource.userData.shadowLightSource = this;
  }

  getPosition(): Vector3 {
    return this._shadowLightSource.position;
  }

  public getShadowLight(): Light {
    return this._shadowLightSource;
  }

  public getOriginalLight(): Light | null {
    return null;
  }

  public dispose(): void {
    this._shadowLightSource.dispose();
  }

  addTo(parent: Object3D): void {
    parent.add(this._shadowLightSource);
  }

  removeFrom(parent: Object3D): void {
    parent.remove(this._shadowLightSource);
  }

  public updatePositionAndTarget() {
    this._updateShadowPositionAndTarget(
      this.getPosition(),
      new Vector3(0, 0, 0)
    );
  }

  public updateBounds(sceneBounds: SceneVolume): void {
    if (this._shadowLightSource instanceof SpotLight) {
      const camera = this._shadowLightSource.shadow.camera as PerspectiveCamera;
      const cameraViewBounds = sceneBounds.bounds
        .clone()
        .applyMatrix4(camera.matrixWorldInverse);
      const near = Math.max(
        0.001,
        Math.min(-cameraViewBounds.min.z, -cameraViewBounds.max.z)
      );
      const far = Math.max(-cameraViewBounds.min.z, -cameraViewBounds.max.z);
      const halfWidth = Math.max(
        Math.abs(cameraViewBounds.min.x),
        Math.abs(cameraViewBounds.max.x)
      );
      const halfHeight = Math.max(
        Math.abs(cameraViewBounds.min.y),
        Math.abs(cameraViewBounds.max.y)
      );
      const angle = Math.atan2(Math.hypot(halfHeight, halfWidth) * 1.05, near);
      camera.aspect = 1;
      camera.near = near;
      camera.far = far;
      this._shadowLightSource.angle = angle;
    } else if (this._shadowLightSource.shadow) {
      const camera = this._shadowLightSource.shadow.camera;
      sceneBounds.updateCameraViewVolumeFromBounds(camera);
      const c = camera as OrthographicCamera | PerspectiveCamera;
      c.far += c.far - c.near;
      c.updateProjectionMatrix();
    }
    if (this._shadowLightSource.shadow) {
      this._shadowLightSource.shadow.needsUpdate = true;
    }
  }

  public forceShadowUpdate(): void {
    if (this._shadowLightSource.shadow) {
      this._shadowLightSource.shadow.needsUpdate = true;
    }
  }

  protected _updateShadowPositionAndTarget(
    cameraPosition: Vector3,
    targetPosition: Vector3
  ): void {
    if (this._shadowLightSource instanceof SpotLight) {
      const lightDirection = targetPosition.clone().sub(cameraPosition);
      const distance = lightDirection.length();
      lightDirection.normalize();
      const shadowCameraPosition = targetPosition
        .clone()
        .sub(lightDirection.clone().multiplyScalar(distance * 4));
      this._shadowLightSource.shadow.camera.position.copy(shadowCameraPosition);
      this._shadowLightSource.shadow.camera.position.copy(shadowCameraPosition);
      this._shadowLightSource.shadow.camera.lookAt(targetPosition);
      this._shadowLightSource.position.copy(shadowCameraPosition);
      this._shadowLightSource.lookAt(targetPosition);
    } else {
      this._shadowLightSource.position.copy(cameraPosition);
      this._shadowLightSource.lookAt(targetPosition);
      this._shadowLightSource.shadow?.camera.position.copy(cameraPosition);
      this._shadowLightSource.shadow?.camera.lookAt(targetPosition);
    }
    this._shadowLightSource.shadow?.camera.updateMatrixWorld();
    this._shadowLightSource.updateMatrixWorld();
  }

  public _updateShadowType(
    typeParameters: ShadowTypeParameters,
    shadowScale: number
  ): void {
    const shadow = this._shadowLightSource.shadow;
    if (shadow) {
      shadow.bias = typeParameters.bias;
      shadow.normalBias = typeParameters.normalBias * shadowScale;
      shadow.radius = typeParameters.radius;
      shadow.needsUpdate = true;
    }
  }

  public prepareRenderShadow(): ActiveShadowLight[] {
    return [];
  }

  public finishRenderShadow(): void {
    return;
  }
}

export interface DirectionalShadowLightSourceParameters
  extends BaseShadowLightSourceParameters {
  shadowLightSourceType?: ShadowLightSourceType;
  addHelper?: boolean;
}

export class RectAreaShadowLightSource extends BaseShadowLightSource {
  private _rectAreaLight: RectAreaLight;
  private _rectLightHelper?: RectAreaLightHelper;

  constructor(
    rectAreaLight: RectAreaLight,
    parameters: DirectionalShadowLightSourceParameters
  ) {
    let lightSource: Light;
    switch (parameters?.shadowLightSourceType) {
      default:
      case ShadowLightSourceType.DirectionalLightShadow:
        lightSource = new DirectionalLight(0xffffff, 1);
        break;
      case ShadowLightSourceType.SpotLightShadow:
        lightSource = new SpotLight(0xffffff, 1, 0, Math.PI / 4, 0);
        break;
    }
    lightSource.position.copy(rectAreaLight.position);
    lightSource.lookAt(0, 0, 0);
    super(lightSource, parameters);
    this._rectAreaLight = rectAreaLight;
    this._rectAreaLight.userData.shadowLightSource = this;
    if (parameters?.addHelper) {
      this._rectLightHelper = new RectAreaLightHelper(this._rectAreaLight);
      (this._rectLightHelper.material as LineBasicMaterial).depthWrite = false;
      this._rectAreaLight.add(this._rectLightHelper);
    }
  }

  public getPosition(): Vector3 {
    return this._rectAreaLight.position;
  }

  public getRectAreaLight(): RectAreaLight {
    return this._rectAreaLight;
  }

  public getOriginalLight(): Light | null {
    return this._rectAreaLight;
  }

  public prepareRenderShadow(): ActiveShadowLight[] {
    this._isVisibleBackup = this._rectAreaLight.visible;
    this._castShadowBackup = this._shadowLightSource.castShadow;
    this._shadowLightSource.visible = this._rectAreaLight.visible;
    this._rectAreaLight.visible = false;
    if (!this._shadowLightSource.visible) {
      return [];
    }
    return [
      {
        light: this._shadowLightSource,
        intensity: this._rectAreaLight.intensity,
      },
    ];
  }

  public finishRenderShadow(): void {
    this._shadowLightSource.visible = false;
    this._shadowLightSource.castShadow = this._castShadowBackup;
    this._rectAreaLight.visible = this._isVisibleBackup;
  }
}

export interface EnvironmentShadowLightSourceParameters
  extends BaseShadowLightSourceParameters {
  shadowLightSourceType?: ShadowLightSourceType;
}

export class EnvironmentShadowLightSource extends BaseShadowLightSource {
  private _position: Vector3;
  private _intensity: number;

  constructor(
    position: Vector3,
    lightIntensity: number,
    parameters: EnvironmentShadowLightSourceParameters
  ) {
    const directionalLight = new DirectionalLight(0xffffff, lightIntensity);
    directionalLight.position.copy(position);
    directionalLight.lookAt(0, 0, 0);
    directionalLight.updateMatrix();
    directionalLight.castShadow = true;
    super(directionalLight, parameters);
    this._position = position.clone();
    this._intensity = lightIntensity;
  }

  getPosition(): Vector3 {
    return this._position;
  }

  public prepareRenderShadow(): ActiveShadowLight[] {
    this._castShadowBackup = this._shadowLightSource.castShadow;
    this._shadowLightSource.visible = true;
    return [
      {
        light: this._shadowLightSource,
        intensity: this._intensity,
      },
    ];
  }

  public finishRenderShadow(): void {
    this._shadowLightSource.castShadow = this._castShadowBackup;
    this._shadowLightSource.visible = false;
  }
}
