import type { GeometryAndMaterial, MaterialData } from './meshConstructor';
import { createSceneGroup } from './meshConstructor';
import { LightSources } from './lightSources';
import type { GroundMaterialType } from './materials';
import {
  createGroundMaterial,
  createPreviewMaterial,
  GROUND_MATERIAL_TYPES,
} from './materials';
import { EnvironmentLoader } from '../loader/environment_map/environmentLoader';
import { SkyEnvironment } from './skyEnvironment';
import { BackgroundEnvironment } from '../renderer/background-environment';
import { createNoiseTexture, getMaxSamples } from '../renderer/render-utility';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { Controls } from './controls';
import type {
  LutImageDefinition,
  OutlineParameters,
  SceneRendererParameters,
} from '../renderer/scene-renderer';
import { QUALITY_LEVELS, SceneRenderer } from '../renderer/scene-renderer';
import { DimensioningArrow } from './dimensioningArrow';
import {
  DefaultEnvironmentSceneGenerator,
  DEFAULT_ENVIRONMENT_SCENE_TYPES,
} from '../renderer/environment-scene';
import { defaultQualityLevels } from './quality-levels';
import type {
  BufferGeometry,
  Material,
  Object3D,
  Texture,
  Vector2,
  WebGLRenderer,
} from 'three';
import {
  Box3,
  BoxGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  RepeatWrapping,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
} from 'three';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GroundedSkybox } from 'three/examples/jsm/objects/GroundedSkybox.js';
// @ts-ignore
import Test64EnvMap from './../../../resources/test64.envmap';
// @ts-ignore
import Bourbon64CUBE from './../../../resources/luts/Bourbon 64.CUBE';
// @ts-ignore
import Chemical168CUBE from './../../../resources/luts/Chemical 168.CUBE';
// @ts-ignore
import Clayton33CUBE from './../../../resources/luts/Clayton 33.CUBE';
// @ts-ignore
import Cubicle99CUBE from './../../../resources/luts/Cubicle 99.CUBE';
// @ts-ignore
import Remy24CUBE from './../../../resources/luts/Remy 24.CUBE';
// @ts-ignore
import PresetproCinematic3dl from './../../../resources/luts/Presetpro-Cinematic.3dl';
// @ts-ignore
import NeutralLUT from './../../../resources/luts/NeutralLUT.png';
// @ts-ignore
import BandWLUT from './../../../resources/luts/B&WLUT.png';
// @ts-ignore
import NightLUT from './../../../resources/luts/NightLUT.png';

const lutImages: LutImageDefinition[] = [
  { name: 'Bourbon 64', url: Bourbon64CUBE, type: 'cube' },
  { name: 'Chemical 168', url: Chemical168CUBE, type: 'cube' },
  { name: 'Clayton 33', url: Clayton33CUBE, type: 'cube' },
  { name: 'Cubicle 99', url: Cubicle99CUBE, type: 'cube' },
  { name: 'Remy 24', url: Remy24CUBE, type: 'cube' },
  {
    name: 'Presetpro Cinematic',
    url: PresetproCinematic3dl,
    type: '3dl',
  },
  { name: 'Neutral', url: NeutralLUT, type: 'image' },
  { name: 'B&W', url: BandWLUT, type: 'image' },
  { name: 'Night', url: NightLUT, type: 'image' },
];

export interface SceneProperties {
  rotate: number;
  randomOrientation: boolean;
  dimensions: boolean;
  materialNoise: boolean;
}

export class SceneManager {
  public properties: SceneProperties = {
    rotate: 0,
    randomOrientation: false,
    dimensions: false,
    materialNoise: false,
  };
  public showEnvironment: boolean = false;
  public environmentRotation: number = 0;
  public environmentIntensity: number = 1;
  private renderer: WebGLRenderer;
  private css2Renderer?: CSS2DRenderer;
  public sceneRenderer: SceneRenderer;
  private camera: PerspectiveCamera;
  private controls?: Controls;
  public scene: Scene;
  private lightSources: LightSources;
  private sceneBounds = new Box3();
  private turnTableGroup = new Group();
  private scaleShadowAndAo: boolean = false;
  public groundMaterialType: GroundMaterialType =
    GROUND_MATERIAL_TYPES.ONL_SHADOW;
  private noiseTexture: Texture;
  private raycaster = new Raycaster();
  public environmentLoader: EnvironmentLoader;
  private transformControls?: TransformControls;
  public skyEnvironment: SkyEnvironment;
  public backgroundEnvironment: BackgroundEnvironment;
  public dimensioningArrows: DimensioningArrow[] = [];
  public dimensioningArrowScene = new Scene();
  private groundMesh?: Mesh;
  private groundProjectionSkybox: Mesh | null = null;
  private createGroundProjectionSkybox: boolean = false;
  private groundProjectionSkyboxDistance: number = 100;
  public dracoLoader = new DRACOLoader();

  public get sceneRenderParameters(): SceneRendererParameters {
    return this.sceneRenderer.parameters;
  }

  public constructor(renderer: WebGLRenderer, css2Renderer?: CSS2DRenderer) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const maxSamples = getMaxSamples(renderer);
    this.renderer = renderer;
    this.css2Renderer = css2Renderer;
    this.environmentLoader = new EnvironmentLoader();
    this.camera = new PerspectiveCamera(45, width / height, 0.1, 10);
    this.camera.position.z = 2;
    this.scene = new Scene();
    renderer.outputColorSpace = SRGBColorSpace;
    this.sceneRenderer = new SceneRenderer(this.renderer, width, height);
    this.lightSources = new LightSources(
      this.scene,
      this.sceneRenderer,
      width,
      height,
      maxSamples
    );
    // The ground must be tessellated to avoid shadow glitches
    //const groundGeometry = new PlaneGeometry(100000, 100000, 100, 100)
    const groundGeometry = new RingGeometry(0, 50000, 36, 100);
    const groundMaterial = createGroundMaterial(this.groundMaterialType);
    this.updateGround(groundGeometry, groundMaterial);
    this.turnTableGroup = new Group();
    this.scene.add(this.turnTableGroup);
    this.noiseTexture = createNoiseTexture(512, 0.9, 1);
    this.noiseTexture.anisotropy = 16;
    this.noiseTexture.wrapS = RepeatWrapping;
    this.noiseTexture.wrapT = RepeatWrapping;
    this.update(undefined, this.constructLoadingGeometry(0));
    this.sceneRenderer.updateParameters({
      outlineParameters: {
        enabled: false,
        edgeStrength: 5.0,
        edgeGlow: 1.0,
        edgeThickness: 1.0,
        //visibleEdgeColor: 0xff0000,
        //hiddenEdgeColor: 0xff0000,
      } as OutlineParameters,
    });
    this.sceneRenderer.setQualityLevel(QUALITY_LEVELS.HIGHEST);
    this.skyEnvironment = new SkyEnvironment();
    this.skyEnvironment.addToScene(this.scene);
    this.backgroundEnvironment = new BackgroundEnvironment();
    this.backgroundEnvironment.addToScene(this.scene);
    this.sceneRenderer.setQualityMap(defaultQualityLevels);
    this.loadLutImages();
  }

  public getLightSources(): LightSources {
    return this.lightSources;
  }

  public async loadResource(
    resourceName: string,
    resource: string,
    newEnvironment: (name: string) => void,
    newModel: (name: string, sceneGroup: Group | null) => void
  ) {
    try {
      const changeEnvironment = () => {
        this.skyEnvironment.changeVisibility(false);
        this.backgroundEnvironment.hideBackground();
        this.showEnvironment = true;
      };
      const lowerName = resourceName.toLowerCase();
      if (lowerName.endsWith('.exr')) {
        this.environmentLoader.loadExr(resourceName, resource, true);
        changeEnvironment();
      } else if (lowerName.endsWith('.hdr')) {
        this.environmentLoader.loadHdr(resourceName, resource, true);
        changeEnvironment();
      } else if (lowerName.endsWith('.envmap')) {
        this.environmentLoader.loadEnvmap(resourceName, resource, true);
        changeEnvironment();
      } else if (lowerName.endsWith('.glb') || lowerName.endsWith('.gltf')) {
        newModel(resourceName, null);
        const sceneGroup = await this.loadGLTF(resource);
        newModel(resourceName, sceneGroup);
      }
    } catch (e) {
      console.log(e);
    }
  }

  public loadLutImages() {
    this.sceneRenderer.loadLutImages(lutImages);
  }

  public createControls(): void {
    this.controls ??= new Controls(this.renderer, this.camera);
  }

  public changeLightControls(on: boolean) {
    if (on && !this.transformControls) {
      this.transformControls = this.controls?.addTransformControl(
        this.lightSources.getLightSources()[0],
        this.scene
      );
    }
    if (this.transformControls) {
      this.transformControls.getHelper().visible = on;
    }
  }

  public setEnvironment(): void {
    this.environmentLoader.loadDefaultEnvironment(
      true,
      () => {
        return new DefaultEnvironmentSceneGenerator({
          type: DEFAULT_ENVIRONMENT_SCENE_TYPES.ALL_AROUND,
        });
      },
      'room environment'
    );
    this.environmentLoader.loadDefaultEnvironment(
      false,
      () => {
        return new DefaultEnvironmentSceneGenerator({
          type: DEFAULT_ENVIRONMENT_SCENE_TYPES.FRONT,
        });
      },
      'front light environment'
    );
    this.environmentLoader.loadEnvmap('test64.envmap', Test64EnvMap, false);
  }

  public updateSceneDependencies(): void {
    this.sceneRenderer.bakedGroundContactShadowPass.needsUpdate = true;
    this.updateBounds();
  }

  public updateBounds(): void {
    this.sceneRenderer.updateBounds(this.sceneBounds, this.scaleShadowAndAo);
  }

  public setGroundMaterial(groundMaterialType: GroundMaterialType) {
    if (this.groundMaterialType !== groundMaterialType) {
      this.groundMaterialType = groundMaterialType;
      this.updateGround(
        undefined,
        createGroundMaterial(this.groundMaterialType)
      );
      this.sceneRenderer.clearCache();
    }
  }

  public updateGround(geometry?: BufferGeometry, material?: Material) {
    if (!this.groundMesh) {
      this.groundMesh = new Mesh();
      this.groundMesh.name = 'groundMesh';
      this.groundMesh.userData.isFloor = true;
      this.groundMesh.receiveShadow = true;
      this.sceneRenderer.groundGroup.add(this.groundMesh);
    }
    if (geometry) {
      this.groundMesh.geometry = geometry;
    }
    if (material) {
      material.depthWrite = false;
      material.polygonOffset = true;
      material.polygonOffsetFactor = 4;
      material.polygonOffsetUnits = 4;
      material.needsUpdate = true;
      this.groundMesh.material = material;
      this.groundMesh.userData.isFloor = true;
    }
  }

  public update(
    properties?: any,
    meshGroup?: Group,
    scaleScene?: boolean
  ): void {
    if (meshGroup) {
      this.setNewTurntableGroup(meshGroup, scaleScene ?? false);
    }
    if (properties && this.properties.rotate !== properties?.rotate) {
      this.properties.rotate = properties?.rotate;
      if (this.properties.rotate === 0) {
        this.turnTableGroup.rotation.y = 0;
      }
    }
    if (properties && this.properties.dimensions !== properties?.dimensions) {
      this.properties.dimensions = properties?.dimensions;
      this.updateDimensions();
    }
    if (
      properties &&
      this.properties.randomOrientation !== properties?.randomOrientation
    ) {
      this.properties.randomOrientation = properties?.randomOrientation;
    }
  }

  private updateDimensions() {
    if (this.properties.dimensions) {
      if (this.dimensioningArrows.length === 0) {
        for (let i = 0; i < 3; ++i) {
          const dimensioningArrow = new DimensioningArrow(
            new Vector3(),
            new Vector3(),
            {
              color: 0x00000,
              arrowPixelWidth: 10.0,
              arrowPixelHeight: 15.0,
              shaftPixelWidth: 3.0,
              shaftPixelOffset: 1.0,
              labelClass: 'label',
              deviceRatio: window.devicePixelRatio,
            }
          );
          this.dimensioningArrows.push(dimensioningArrow);
          this.dimensioningArrowScene.add(dimensioningArrow);
        }
      }
      const box = this.sceneRenderer.boundingVolume.bounds;
      const size = this.sceneRenderer.boundingVolume.size;
      const arrowOffset = Math.min(size.x, size.y, size.z) * 0.2;
      this.dimensioningArrows[0].setPosition(
        new Vector3(box.min.x, box.min.y, box.max.z + arrowOffset),
        new Vector3(box.max.x, box.min.y, box.max.z + arrowOffset)
      );
      this.dimensioningArrows[1].setPosition(
        new Vector3(
          box.min.x - arrowOffset,
          box.min.y,
          box.max.z + arrowOffset
        ),
        new Vector3(box.min.x - arrowOffset, box.max.y, box.max.z + arrowOffset)
      );
      this.dimensioningArrows[2].setPosition(
        new Vector3(box.min.x - arrowOffset, box.min.y, box.max.z),
        new Vector3(box.min.x - arrowOffset, box.min.y, box.min.z)
      );
    } else {
      this.dimensioningArrows.forEach((dimensioningArrow) =>
        dimensioningArrow.setLabel('')
      );
    }
  }

  public collectMaterials() {
    const materials: MaterialData[] = [];
    this.scene.traverse((node) => {
      if (node instanceof Mesh && node.name.length > 0) {
        const material = node.material as MeshPhysicalMaterial;
        if (material) {
          materials.push({ materialId: node.name, material });
        }
      } else if (node instanceof Mesh && node.material.name.length > 0) {
        const material = node.material as MeshPhysicalMaterial;
        if (material) {
          const name = node.material.name;
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          materials.findIndex(
            (materialData) => materialData.materialId === name
          ) === -1 && materials.push({ materialId: name, material });
        }
      }
    });
    return materials;
  }

  public updateMaterialProperties(
    properties: SceneProperties,
    materials: MaterialData[]
  ): void {
    if (this.properties.materialNoise !== properties.materialNoise) {
      this.properties.materialNoise = properties.materialNoise;
      materials.forEach((materialData) => {
        const material = materialData.material as MeshPhysicalMaterial;
        if (!material.userData || !('ormMap' in material.userData)) {
          material.roughnessMap = this.properties.materialNoise
            ? this.noiseTexture
            : null;
          material.metalnessMap = this.properties.materialNoise
            ? this.noiseTexture
            : null;
          //material.aoMap = this.properties.materialNoise ? this.noiseTexture : null
          material.needsUpdate = true;
        }
      });
    }
  }

  public resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.sceneRenderer.setSize(width, height);
    this.css2Renderer?.setSize(width, height);
  }

  public animate(elapsedMilliseconds: number): void {
    if (this.properties.rotate > 0) {
      this.turnTableGroup.rotation.y +=
        Math.PI * 2 * elapsedMilliseconds * 0.001 * this.properties.rotate;
    }
  }

  public prepareRender(mousePosition: Vector2): void {
    const changed = this.environmentLoader.setEnvironment(this.scene, {
      showEnvironment: this.showEnvironment,
      environmentRotation: this.environmentRotation,
      environmentIntensity: this.environmentIntensity,
    });
    if (changed) {
      this.groundProjectionSkybox?.removeFromParent();
      this.groundProjectionSkybox = null;
      const equirectangularTexture =
        this.environmentLoader.currentEnvironment?.equirectangularTexture;
      this.scene.userData.shadowFromEnvironment = true;
      if (equirectangularTexture) {
        this.lightSources.currentLightSourceDefinition =
          LightSources.noLightSources;
        this.lightSources.updateLightSources();
        if (this.createGroundProjectionSkybox) {
          this.groundProjectionSkybox = new GroundedSkybox(
            equirectangularTexture,
            1.5,
            10
          );
          this.groundProjectionSkybox.scale.setScalar(
            this.groundProjectionSkyboxDistance
          );
          this.groundProjectionSkybox.name = 'skybox';
          this.scene.add(this.groundProjectionSkybox);
        }
      }
    }
    const minimumFar =
      this.createGroundProjectionSkybox && this.groundProjectionSkybox
        ? this.groundProjectionSkyboxDistance * 2
        : undefined;
    this.sceneRenderer.updateNearAndFarPlaneOfPerspectiveCamera(
      this.camera,
      minimumFar
    );
    if (changed) {
      this.updateSceneDependencies();
    }
    if (this.sceneRenderer.outlineRenderer.parameters.enabled) {
      this.raycaster.setFromCamera(mousePosition, this.camera);
      const intersects = this.raycaster.intersectObject(
        this.turnTableGroup,
        true
      );
      const selectedObject =
        intersects.length > 0 ? intersects[0].object : undefined;
      this.sceneRenderer.selectObjects(selectedObject ? [selectedObject] : []);
    }
  }

  public render(updateControls: boolean = true): void {
    if (updateControls) {
      this.controls?.update();
    }
    this.backgroundEnvironment.update(
      this.sceneRenderer.width,
      this.sceneRenderer.height,
      this.camera
    );
    this.sceneRenderer.render(this.scene, this.camera);
    if (this.properties.dimensions) {
      this.dimensioningArrows.forEach((arrow) => {
        arrow.arrowNeedsUpdate = true;
      });
      this.renderer.autoClear = false;
      this.renderer.render(this.dimensioningArrowScene, this.camera);
      this.css2Renderer?.render(this.dimensioningArrowScene, this.camera);
      this.renderer.autoClear = true;
    }
  }

  private async loadGLTF(resource: string): Promise<Group> {
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(this.dracoLoader);
    const gltf = await gltfLoader.loadAsync(resource);
    this.updateGLTFScene(gltf, (mesh: Mesh) => {
      if (mesh.isMesh) {
        const material = mesh.material;
        if (material instanceof MeshStandardMaterial) {
          if (material.transparent === false) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        }
      }
    });
    this.setNewTurntableGroup(gltf.scene, true);
    return gltf.scene;
  }

  private updateGLTFScene(gltf: GLTF, updateMesh: (mesh: Mesh) => void): void {
    gltf.scene.traverse((child) => {
      if (child instanceof Mesh) {
        updateMesh(child);
        if (child.material instanceof MeshStandardMaterial) {
          child.material.envMapIntensity = 1;
          child.material.needsUpdate = true;
        }
      }
    });
  }

  private setNewTurntableGroup(newGroup: Group, scaleScene: boolean): void {
    this.turnTableGroup.clear();
    this.scaleShadowAndAo = scaleScene;
    this.setInitialObjectPosition(newGroup);
    this.setInitialCameraPositionAndRotation();
    if (!this.sceneRenderer.environmentLights) {
      this.lightSources.setLightSourcesDistances(
        this.sceneRenderer.boundingVolume,
        scaleScene
      );
    }
    this.sceneRenderer.forceShadowUpdates(true);
    this.updateSceneDependencies();
  }

  private setInitialObjectPosition(meshGroup: Object3D): void {
    meshGroup.updateMatrixWorld();
    this.sceneBounds.setFromObject(meshGroup);
    const size = this.sceneBounds.getSize(new Vector3());
    const center = this.sceneBounds.getCenter(new Vector3());
    meshGroup.applyMatrix4(
      new Matrix4().makeTranslation(
        -center.x,
        -this.sceneBounds.min.y,
        -center.z
      )
    );
    this.sceneBounds.translate(
      new Vector3(-center.x, -this.sceneBounds.min.y - size.y / 2, -center.z)
    );
    const groundLevel = -size.y / 2;
    this.turnTableGroup.position.y = groundLevel;
    this.turnTableGroup.add(meshGroup);
    this.turnTableGroup.updateMatrixWorld();
    this.sceneRenderer.groundLevel = groundLevel;
  }

  private setInitialCameraPositionAndRotation(): void {
    const directionToCamera = new Vector3(-1.5, 0.8, 2.5).normalize();
    if (this.properties.randomOrientation) {
      const x = Math.random() * 4 - 2;
      const y = Math.random() * 0.8 + 0.4;
      directionToCamera.set(x, y, 2.5).normalize();
    }
    this.camera.position.copy(directionToCamera);
    this.camera.lookAt(new Vector3(0, 0, 0));
    this.camera.updateMatrixWorld();
    const bounds = new Box3()
      .setFromObject(this.turnTableGroup)
      .applyMatrix4(this.camera.matrixWorldInverse);
    const halfFov = (this.camera.fov * Math.PI) / 180 / 2;
    const aspect = this.camera.aspect;
    const maxSide = Math.max(
      -bounds.min.x / aspect,
      bounds.max.x / aspect,
      -bounds.min.y,
      bounds.max.y
    );
    const minDistance = maxSide / Math.tan(halfFov) + bounds.max.z + 1;
    this.camera.position.copy(directionToCamera.multiplyScalar(minDistance));
    this.camera.lookAt(new Vector3(0, 0, 0));
    this.camera.updateMatrixWorld();
  }

  private constructLoadingGeometry(type: number): Group {
    let loadingGeometry: GeometryAndMaterial[] = [];
    if (type === 1) {
      const points = [];
      for (let a = 0; a <= 230; a += 15) {
        const ar = (a * Math.PI) / 180;
        points.push({ x: -Math.cos(ar), y: Math.sin(ar) + 1 });
      }
      points.push({ x: 0, y: 0 });
      for (let a = 60; a >= -180; a -= 15) {
        const ar = (a * Math.PI) / 180;
        points.push({ x: -Math.cos(ar), y: Math.sin(ar) - 1 });
      }
      const radius = 0.6;
      const gap = 2.5 * radius;
      const path = new CatmullRomCurve3(
        points.map((p) => new Vector3(p.x, p.y + 2 + gap, 0))
      );
      const tube = new TubeGeometry(path, 64, radius, 16, false);
      const sphereS = new SphereGeometry(radius, 32, 16);
      sphereS.translate(-1, 3 + gap, 0);
      const sphereE = new SphereGeometry(radius, 32, 16);
      sphereE.translate(1, 1 + gap, 0);
      const sphere = new SphereGeometry(radius, 32, 16);
      const material = new MeshPhysicalMaterial({
        color: 0xdb0000,
        side: DoubleSide,
      });
      loadingGeometry = [
        {
          geometry: tube,
          material,
          materialId: '',
          environment: false,
        },
        {
          geometry: sphereS,
          material,
          materialId: '',
          environment: false,
        },
        {
          geometry: sphereE,
          material,
          materialId: '',
          environment: false,
        },
        {
          geometry: sphere,
          material,
          materialId: '',
          environment: false,
        },
      ];
    } else {
      const material = createPreviewMaterial();
      loadingGeometry = [
        {
          geometry: new BoxGeometry(),
          material,
          materialId: '',
          environment: false,
        },
      ];
    }
    return createSceneGroup(loadingGeometry);
  }
}
