import { SceneVolume } from './render-utility';
import type { CopyTransformMaterial } from './shader-utility';
import type { GBufferParameters } from './pass/gbuffer-render-pass';
import type { GBufferRenderPass } from './pass/gbuffer-render-pass';
import { ShadowGroundPlane } from './objects/shadow-ground-plane';
import type { BakedGroundContactShadowParameters } from './pass/baked-ground-contact-shadow-pass';
import type { BakedGroundContactShadowPass } from './pass/baked-ground-contact-shadow-pass';
import type { GroundReflectionParameters } from './pass/ground-reflection-pass';
import type { GroundReflectionPass } from './pass/ground-reflection-pass';
import type { ScreenSpaceShadowMapParameters } from './pass/screen-space-shadow-map-pass';
import type { ScreenSpaceShadowMapPass } from './pass/screen-space-shadow-map-pass';
import type {
  ShadowAndAoPassParameters,
  ShadowBlurType,
} from './pass/shadow-and-ao-pass';
import type { ShadowAndAoPass } from './pass/shadow-and-ao-pass';
import { SHADOW_BLUR_TYPES } from './pass/shadow-and-ao-pass';
import type { OutlineParameters } from './outline-renderer';
import { OutlineRenderer } from './outline-renderer';
import type { DebugPass } from './pass/debug-pass';
import type { LightSource } from './light-source-detection';
import {
  mapCustomShadingParameters,
  mergeRendererParameters,
  getInteractionParameters,
  getShadingParameters,
  SCENE_SHADING_TYPES,
} from './shading-settings';
import type {
  CustomShadingParameters,
  SceneShadingType,
} from './shading-settings';
import {
  DepthWriteRenderCache,
  isTransmissiveMaterial,
  RenderCacheManager,
  VisibilityRenderCache,
} from './render-cache';
import type { LutPassParameters } from './render-pass-manager';
import { RenderPassManager } from './render-pass-manager';
import type { SceneRenderPass } from './pass/scene-render-pass';
import type { Enumify, Nullable } from '../utils/types';
import type {
  Box3,
  Camera,
  Object3D,
  PerspectiveCamera,
  RectAreaLight,
  Scene,
  WebGLRenderer,
} from 'three';
import { Group, Mesh } from 'three';

export { type BakedGroundContactShadowParameters } from './pass/baked-ground-contact-shadow-pass';
export { type OutlineParameters } from './outline-renderer';
export {
  type ShadowParameters,
  type ShadowAndAoPassParameters,
} from './pass/shadow-and-ao-pass';
export { type AORenderPassParameters } from './pass/ao-pass';
export { type GroundReflectionParameters } from './pass/ground-reflection-pass';

interface WithUserData {
  userData?: Record<string, any>;
}

export const QUALITY_LEVELS = {
  HIGHEST: 'highest',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;

export type QualityLevel = Enumify<typeof QUALITY_LEVELS>;

export type QualityMap = Map<QualityLevel, any>;

export interface LutImageDefinition {
  name: string;
  url: string;
  type: string;
}

export interface SceneRendererParameters {
  gBufferRenderTargetParameters: GBufferParameters;
  shAndAoPassParameters: ShadowAndAoPassParameters;
  screenSpaceShadowMapParameters: ScreenSpaceShadowMapParameters;
  groundReflectionParameters: GroundReflectionParameters;
  bakedGroundContactShadowParameters: BakedGroundContactShadowParameters;
  outlineParameters: OutlineParameters;
  effectSuspendFrames: number;
  effectFadeInFrames: number;
  suspendGroundReflection: boolean;
  shadowOnCameraChange: ShadowBlurType;
}

export interface SceneRendererChangeParameters {
  shadowType?: string;
  shAndAoPassParameters?: ShadowAndAoPassParameters;
  screenSpaceShadowMapParameters?: ScreenSpaceShadowMapParameters;
  groundReflectionParameters?: GroundReflectionParameters;
  bakedGroundContactShadowParameters?: BakedGroundContactShadowParameters;
  outlineParameters?: OutlineParameters;
  effectSuspendFrames?: number;
  effectFadeInFrames?: number;
  suspendGroundReflection?: boolean;
  shadowOnCameraChange?: ShadowBlurType;
}

export class SceneRenderer {
  public parameters: SceneRendererParameters;
  public debugOutput = 'off';
  public outputColorSpace = '';
  public toneMapping = '';
  public linearAoFilter = true;
  public environmentLights = false;
  public enableObjectSelection: boolean = true;
  public groundLevel: number = 0;
  public uiInteractionMode: boolean = false;
  public renderer: WebGLRenderer;
  public width: number = 0;
  public height: number = 0;
  public boundingVolume = new SceneVolume();
  public boundingVolumeSet: boolean = false;
  public renderCacheManager: RenderCacheManager = new RenderCacheManager();
  private _renderPassManager: RenderPassManager;
  private _shadowAndAoGroundPlane: ShadowGroundPlane;
  public outlineRenderer: OutlineRenderer;
  public selectedObjects: Object3D[] = [];
  private _copyMaterial?: CopyTransformMaterial;
  public readonly groundGroup: Group = new Group();
  private _shadingType: SceneShadingType = SCENE_SHADING_TYPES.DEFAULT;
  private _qualityLevel: QualityLevel = QUALITY_LEVELS.HIGHEST;
  private _qualityMap: QualityMap = new Map<QualityLevel, any>();
  private _customShadingParameters: Nullable<CustomShadingParameters> = null;

  public get sceneRenderPass(): SceneRenderPass {
    return this._renderPassManager.sceneRenderPass;
  }

  public get bakedGroundContactShadowPass(): BakedGroundContactShadowPass {
    return this._renderPassManager.bakedGroundContactShadowPass;
  }

  public get gBufferRenderPass(): GBufferRenderPass {
    return this._renderPassManager.gBufferRenderPass;
  }

  public get groundReflectionPass(): GroundReflectionPass {
    return this._renderPassManager.groundReflectionPass;
  }

  public get screenSpaceShadowMapPass(): ScreenSpaceShadowMapPass {
    return this._renderPassManager.screenSpaceShadowMapPass;
  }

  public get shadowAndAoPass(): ShadowAndAoPass {
    return this._renderPassManager.shadowAndAoPass;
  }

  public get lutPassParameters(): LutPassParameters {
    return this._renderPassManager.lutPassParameters;
  }

  public get lutMaps(): string[] {
    return this._renderPassManager.lutMaps;
  }

  public get debugPass(): DebugPass {
    return this._renderPassManager.debugPass;
  }

  public get shadowAndAoGroundPlane(): ShadowGroundPlane {
    return this._shadowAndAoGroundPlane;
  }

  public constructor(
    renderer: WebGLRenderer,
    width: number,
    height: number,
    linearAoFilter?: boolean
  ) {
    this.width = width;
    this.height = height;
    this.linearAoFilter = linearAoFilter ?? true;
    this.renderer = renderer;
    this.renderCacheManager.registerCache(
      'inivisibleGround',
      new VisibilityRenderCache((object: any) => {
        return object === this.groundGroup;
      })
    );
    this.renderCacheManager.registerCache(
      'groundReflection',
      new VisibilityRenderCache((object: any) => {
        if (object === this.groundGroup) {
          return true;
        } else if (
          object instanceof Mesh &&
          isTransmissiveMaterial((object as Mesh).material)
        ) {
          return true;
        }
        return false;
      })
    );
    this.renderCacheManager.registerCache('debug', new VisibilityRenderCache());
    this.renderCacheManager.registerCache(
      'floorDepthWrite',
      new DepthWriteRenderCache((mesh: Mesh) => {
        return mesh.userData?.isFloor;
      })
    );
    this._shadowAndAoGroundPlane = new ShadowGroundPlane(null);
    this.groundGroup.rotateX(-Math.PI / 2);
    this._renderPassManager = new RenderPassManager(this);
    this.outlineRenderer = new OutlineRenderer(
      this._renderPassManager,
      null,
      {}
    );
    this.parameters = {
      gBufferRenderTargetParameters: this.gBufferRenderPass.parameters,
      bakedGroundContactShadowParameters:
        this.bakedGroundContactShadowPass.parameters,
      screenSpaceShadowMapParameters: this.screenSpaceShadowMapPass.parameters,
      shAndAoPassParameters: this.shadowAndAoPass.parameters,
      groundReflectionParameters: this.groundReflectionPass.parameters,
      outlineParameters: this.outlineRenderer.parameters,
      effectSuspendFrames: 0,
      effectFadeInFrames: 0,
      suspendGroundReflection: false,
      shadowOnCameraChange: SHADOW_BLUR_TYPES.OFF,
    };
    this._addEventListeners(this.renderer);
  }

  private _addEventListeners(renderer: WebGLRenderer) {
    renderer.domElement.addEventListener('webglcontextlost', () => {
      console.log('webglcontextlost');
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      console.log('webglcontextrestored');
      this._forceEnvironmentMapUpdate(this.renderer);
    });
  }

  public dispose(): void {
    this._copyMaterial?.dispose();
    this._renderPassManager.dispose();
    this.renderer.dispose();
  }

  public setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this._renderPassManager.setSize(width, height);
    this.renderer.setSize(width, height);
  }

  public loadLutImages(luts: LutImageDefinition[]): void {
    for (const lut of luts) {
      if (lut.type === 'image') {
        this._renderPassManager.loadLutImage(lut.name, lut.url);
      } else if (lut.type === 'cube') {
        this._renderPassManager.loadLutCube(lut.name, lut.url);
      } else if (lut.type === '3dl') {
        this._renderPassManager.loadLut3dl(lut.name, lut.url);
      }
    }
  }

  public getQualityLevel() {
    return this._qualityLevel;
  }

  public setShadingType(shadingType: SceneShadingType): void {
    if (this._shadingType === shadingType) {
      return;
    }
    this._shadingType = shadingType;
    this.applyCurrentParameters();
  }

  public setQualityLevel(qualityLevel: QualityLevel): void {
    if (this._qualityLevel === qualityLevel) {
      return;
    }
    if (this._qualityMap.has(this._qualityLevel)) {
      this._qualityLevel = qualityLevel;
    }
    this.applyCurrentParameters();
  }

  public setQualityMap(qualityMap: QualityMap) {
    this._qualityMap = qualityMap;
    this.applyCurrentParameters();
  }

  public setCustomShadingParameters(
    customShadingParameters: CustomShadingParameters
  ) {
    this._customShadingParameters = customShadingParameters;
    this.applyCurrentParameters();
    this.requestUpdateOfPasses();
  }

  public setQualityMapAndShadingParameters(
    qualityMap: QualityMap,
    customShadingParameters: CustomShadingParameters
  ) {
    this._qualityMap = qualityMap;
    this._customShadingParameters = customShadingParameters;
    this.applyCurrentParameters();
    this.requestUpdateOfPasses();
  }

  public applyCurrentParameters() {
    const parameterArray: Array<Record<string, object>> = [];
    if (this._qualityMap.has(this._qualityLevel)) {
      parameterArray.push(this._qualityMap.get(this._qualityLevel));
    }
    const shadingTypeParameters = getShadingParameters(this._shadingType);
    if (shadingTypeParameters) {
      parameterArray.push(shadingTypeParameters);
    }
    const uiInteractionParameters = getInteractionParameters(
      this.uiInteractionMode
    );
    if (uiInteractionParameters) {
      parameterArray.push(uiInteractionParameters);
    }
    if (this._customShadingParameters) {
      parameterArray.push(
        mapCustomShadingParameters(this._customShadingParameters)
      );
    }
    if (parameterArray.length > 0) {
      const parameters = mergeRendererParameters(...parameterArray);
      this.updateParameters(parameters as SceneRendererChangeParameters);
      this.bakedGroundContactShadowPass.applyParameters();
    }
  }

  public requestUpdateOfPasses() {
    this.gBufferRenderPass.needsUpdate = true;
    this.screenSpaceShadowMapPass.needsUpdate = true;
    this.shadowAndAoPass.needsUpdate = true;
    this.shadowAndAoPass.softShadowPass.needsUpdate = true;
    this._renderPassManager.materialsNeedUpdate = true;
  }

  public clearCache() {
    this.renderCacheManager.clearCache();
    this._renderPassManager.materialsNeedUpdate = true;
  }

  public forceShadowUpdates(updateBakedGroundShadow: boolean): void {
    this.clearCache();
    this.gBufferRenderPass.needsUpdate = true;
    this.screenSpaceShadowMapPass.forceShadowUpdate();
    this.shadowAndAoPass.needsUpdate = true;
    if (updateBakedGroundShadow) {
      this.bakedGroundContactShadowPass.needsUpdate = true;
    }
  }

  public forceLutPassUpdate() {
    this._renderPassManager.lutPassNeedsUpdate = true;
    this._renderPassManager.materialsNeedUpdate = true;
  }

  public updateParameters(parameters: SceneRendererChangeParameters) {
    if (parameters.shadowType) {
      this.screenSpaceShadowMapPass.switchType(parameters.shadowType);
    }
    if (parameters.shAndAoPassParameters !== undefined) {
      this.shadowAndAoPass.updateParameters(parameters.shAndAoPassParameters);
    }
    if (parameters.bakedGroundContactShadowParameters !== undefined) {
      this.bakedGroundContactShadowPass.updateParameters(
        parameters.bakedGroundContactShadowParameters
      );
    }
    if (parameters.screenSpaceShadowMapParameters !== undefined) {
      this.screenSpaceShadowMapPass.updateParameters(
        parameters.screenSpaceShadowMapParameters
      );
    }
    if (parameters.groundReflectionParameters !== undefined) {
      this.groundReflectionPass.updateParameters(
        parameters.groundReflectionParameters
      );
    }
    if (parameters.outlineParameters !== undefined) {
      this.outlineRenderer.updateParameters(parameters.outlineParameters);
    }
    if (parameters.effectSuspendFrames !== undefined) {
      this.parameters.effectSuspendFrames = parameters.effectSuspendFrames;
    }
    if (parameters.effectFadeInFrames !== undefined) {
      this.parameters.effectFadeInFrames = parameters.effectFadeInFrames;
    }
    if (parameters.suspendGroundReflection !== undefined) {
      this.parameters.suspendGroundReflection =
        parameters.suspendGroundReflection;
    }
    if (parameters.shadowOnCameraChange !== undefined) {
      this.parameters.shadowOnCameraChange = parameters.shadowOnCameraChange;
    }
  }

  public addRectAreaLight(
    rectAreaLight: RectAreaLight,
    parent: Object3D
  ): void {
    this.environmentLights = false;
    this.screenSpaceShadowMapPass.addRectAreaLight(rectAreaLight, parent);
    this.shadowAndAoPass.needsUpdate = true;
  }

  public updateRectAreaLights(
    rectAreaLights: RectAreaLight[],
    parent: Object3D
  ): void {
    if (rectAreaLights.length > 0) {
      this.environmentLights = false;
    }
    this.screenSpaceShadowMapPass.updateRectAreaLights(rectAreaLights, parent);
    this.shadowAndAoPass.needsUpdate = true;
  }

  public createShadowFromLightSources(
    parent: Object3D,
    lightSources: LightSource[]
  ): void {
    this.environmentLights = true;
    this.screenSpaceShadowMapPass.createShadowFromLightSources(
      parent,
      lightSources
    );
    this.shadowAndAoPass.needsUpdate = true;
  }

  public selectObjects(selectedObjects: Object3D[]) {
    this.selectedObjects = selectedObjects;
  }

  public updateBounds(bounds: Box3, scaleShadowAndAo: boolean) {
    this.clearCache();
    const sceneBounds = bounds.clone();
    if (sceneBounds.min.y > this.groundLevel) {
      sceneBounds.min.y = this.groundLevel;
    }
    this.boundingVolumeSet = true;
    this.gBufferRenderPass.groundDepthWrite =
      this.shadowAndAoPass.parameters.aoOnGround;
    this.boundingVolume.updateFromBox(sceneBounds);
    const size = this.boundingVolume.size;
    const shadowAndAoScale = (size.x + size.y + size.z) / 3;
    const minBoundsSize = Math.min(size.x, size.y, size.z);
    const maxBoundsSize = Math.max(size.x, size.y, size.z);
    const defaultScale =
      minBoundsSize < 0.5 ? minBoundsSize / 0.5 : size.z > 5 ? size.z / 5 : 1;
    this.bakedGroundContactShadowPass.setScale(
      scaleShadowAndAo ? shadowAndAoScale : defaultScale,
      shadowAndAoScale
    );
    this.groundReflectionPass.updateBounds(
      this.groundLevel,
      Math.min(1, maxBoundsSize)
    );
    this.screenSpaceShadowMapPass.updateBounds(
      this.boundingVolume,
      shadowAndAoScale
    );
    this.shadowAndAoPass.updateBounds(
      this.boundingVolume,
      scaleShadowAndAo ? shadowAndAoScale : Math.min(1, maxBoundsSize * 2)
    );
  }

  public updateNearAndFarPlaneOfPerspectiveCamera(
    camera: PerspectiveCamera,
    minimumFar?: number
  ) {
    // bring the near and far plane as close as possible to geometry
    // this is very likely the most important part for a glitch free and nice SSAO
    const nearFar = this.boundingVolume.getNearAndFarForPerspectiveCamera(
      camera.position,
      3
    );
    camera.near = Math.max(0.00001, nearFar[0] * 0.9);
    camera.far = Math.max(minimumFar ?? camera.near, nearFar[1]);
    camera.updateProjectionMatrix();
  }

  private _forceEnvironmentMapUpdate(renderer: WebGLRenderer) {
    const rendererUserData = (renderer as WithUserData).userData;
    if (rendererUserData?.environmentTexture) {
      const environmentTexture = rendererUserData.environmentTexture;
      rendererUserData.environmentTexture = undefined;
      environmentTexture.dispose();
    }
  }

  private _updateEnvironment(renderer: WebGLRenderer, scene: Scene) {
    if (!scene.userData?.environmentDefinition) {
      return;
    }
    if (!(renderer as WithUserData).userData) {
      (renderer as WithUserData).userData = {};
    }
    const rendererUserData = (renderer as WithUserData).userData;
    if (
      rendererUserData &&
      (scene.userData?.environmentDefinition.needsUpdate ||
        !rendererUserData.environmentTexture ||
        rendererUserData.environmentDefinition !==
          scene.userData.environmentDefinition)
    ) {
      const environmentDefinition = scene.userData.environmentDefinition;
      rendererUserData.environmentDefinition = environmentDefinition;
      rendererUserData.environmentTexture =
        environmentDefinition.createNewEnvironment(renderer);
      if (scene.userData.shadowFromEnvironment) {
        const maxNoOfLightSources = environmentDefinition.maxNoOfLightSources;
        if (maxNoOfLightSources !== undefined) {
          this.screenSpaceShadowMapPass.parameters.maximumNumberOfLightSources =
            maxNoOfLightSources;
        }
        this.createShadowFromLightSources(
          scene,
          environmentDefinition.lightSources
        );
      }
    }
    scene.environment = rendererUserData?.environmentTexture;
    if (scene.userData.showEnvironmentBackground) {
      scene.background = scene.environment;
    } else if (scene.background === scene.environment) {
      scene.background = null;
    }
  }

  public render(scene: Scene, camera: Camera): void {
    scene.add(this.groundGroup);
    this._updateEnvironment(this.renderer, scene);
    this.outlineRenderer.updateOutline(
      scene,
      camera,
      this.enableObjectSelection ? this.selectedObjects : []
    );
    this._renderPassManager.updatePasses(this.renderer, scene, camera);
    this._renderPassManager.renderPasses(this.renderer, scene);
    scene.remove(this.groundGroup);
  }
}
