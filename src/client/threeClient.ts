import { setupDragDrop } from './util/drag_target';
import { glbMap } from './glbMap';
import { SceneManager } from './scene/sceneManager';
import { QualityLevel } from './renderer/scene-renderer';
import { SceneRendererGUI } from './renderer/scene-renderer-gui';
import { MaterialGUI } from './scene/material-gui';
import { LightSourcesGUI } from './scene/lightSources';
import type { SkyEnvironment } from './scene/skyEnvironment';
import { SkyEnvironmentGUI } from './scene/skyEnvironment';
import type { BackgroundEnvironment } from './renderer/background-environment';
import { BackgroundEnvironmentGUI } from './renderer/background-environment';
import { GroundMaterialType } from './scene/materials';
import type { Group } from 'three';
import { Vector2, WebGLRenderer } from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import Stats from 'three/examples/jsm/libs/stats.module';
import { GUI } from 'dat.gui';

const getDeviceType = () => {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet';
  } else if (
    /Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(
      ua
    )
  ) {
    return 'mobile';
  }
  return 'desktop';
};
const deviceType = getDeviceType();
console.log(deviceType);
const isMobile = deviceType === 'mobile';

//const queryString = window.location.search;
//const urlParams = new URLSearchParams(queryString);
//const parameterId = urlParams.get('id');

const sceneCache: any = {};
const setStatus = (message: string, color: string = '#000000') => {
  console.log(`Status information: ${message}`);
  const statusLine = document.getElementById('status-line');
  if (!statusLine) {
    return;
  }
  statusLine.innerText = message;
  statusLine.style.setProperty('color', color);
};
const finishScene = (sceneName: string) => {
  const materialData = renderScene.collectMaterials();
  materialGUI.updateMaterialUI(gui, materialData);
  setStatus(`${sceneName}`);
  generalProperties.sceneName = sceneName.replace(/:/g, '_');
};

const loadGlbMesh = async (glbName: string, glbUrl: string) => {
  let loadedScene = sceneCache[glbUrl];
  if (!loadedScene) {
    await renderScene.loadResource(
      glbName + '.glb',
      glbUrl,
      (_: string) => {},
      (modelName: string, sceneGroup: Group | null) => {
        if (sceneGroup) {
          sceneCache[glbUrl] = { scene: sceneGroup, glb: true };
          finishScene(modelName);
        } else {
          setStatus(`load ${modelName}`, '#ff0000');
        }
      }
    );
    loadedScene = sceneCache[glbUrl];
  }
  setStatus(`render ${glbUrl}`, '#ff0000');
  renderScene.update(undefined, loadedScene.scene, loadedScene.glb);
  finishScene(glbUrl);
};
const loadResource = (resourceName: string, resource: string) => {
  const loadedScene = sceneCache[resourceName];
  if (loadedScene) {
    setStatus(`render ${resourceName}`, '#ff0000');
    renderScene.update(undefined, loadedScene.scene, loadedScene.glb);
    finishScene(resourceName);
  } else {
    renderScene.loadResource(
      resourceName,
      resource,
      (_: string) => {},
      (modelName: string, sceneGroup: Group | null) => {
        if (sceneGroup) {
          sceneCache[resourceName] = { scene: sceneGroup, glb: true };
          finishScene(modelName);
          addNewGlbToMenu(resourceName);
        } else {
          setStatus(`load ${modelName}`, '#ff0000');
        }
      }
    );
  }
};

const setGroundMaterial = () => {
  let groundMaterial: GroundMaterialType = GroundMaterialType.Transparent;
  switch (generalProperties.groundMaterial.toLocaleLowerCase()) {
    default:
      groundMaterial = GroundMaterialType.Transparent;
      break;
    case 'parquet':
      groundMaterial = GroundMaterialType.Parquet;
      break;
    case 'pavement':
      groundMaterial = GroundMaterialType.Pavement;
      break;
  }
  renderScene.setGroundMaterial(groundMaterial);
};

const fixedResolution: any = undefined;
const container = document.getElementById('container') as HTMLDivElement;
const renderer = new WebGLRenderer({
  antialias: !isMobile,
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
container.appendChild(labelRenderer.domElement);

const stats = new Stats();
document.body.appendChild(stats.dom);

const generalProperties = {
  rotate: 0,
  randomOrientation: false,
  dimensions: false,
  materialNoise: false,
  glb: '',
  autoLoad: false,
  autoLoadSaveScene: false,
  groundMaterial: 'onlyshadow',
  bloom: false,
  ssr: false,
  sceneName: 'default',
};

const renderScene = new SceneManager(renderer, labelRenderer);
renderScene.sceneRenderer.setQualityLevel(
  isMobile ? QualityLevel.LOW : QualityLevel.HIGHEST
);
renderScene.createControls();
renderScene.setEnvironment();
renderScene.updateSceneDependencies();
setGroundMaterial();

const gui = new GUI();
const glbMenuItems: any[] = Object.assign(
  {},
  ...glbMap.map((item: any) => ({ [item.name]: item.url }))
);
const glbMenu = gui
  .add<any>(generalProperties, 'glb', glbMenuItems)
  .onChange((value) => {
    if (value !== '') {
      const index = glbMap.findIndex((item: any) => item.url === value);
      const glbName = index >= 0 ? glbMap[index].name : value;
      loadGlbMesh(glbName, value);
    }
  });
const loadGlbFromMap = (name: string) => {
  const index = glbMap.findIndex((item: any) => item.name === name);
  if (index >= 0) {
    const glb = glbMap[index];
    loadGlbMesh(glb.name, glb.url);
  }
};
const addNewGlbToMenu = (resourceName: string) => {
  glbMenuItems.push(resourceName);
  let innerHTMLStr = '';
  glbMenuItems.forEach((value) => {
    innerHTMLStr += `<option value='${value.name}'>${value.name}</option>`;
  });
  glbMenu.domElement.children[0].innerHTML = innerHTMLStr;
  glbMenu.setValue(resourceName);
  glbMenu.updateDisplay();
};
gui
  .add<any>(generalProperties, 'randomOrientation')
  .onChange(() => renderScene.update(generalProperties));
//gui.add<any>(generalProperties, 'rotate', 0, 0.25).onChange(() => renderScene.update(generalProperties))
gui
  .add<any>(generalProperties, 'dimensions')
  .onChange(() => renderScene.update(generalProperties));
gui
  .add<any>(generalProperties, 'groundMaterial', {
    shadow: 'onlyshadow',
    parquet: 'parquet',
    pavement: 'pavement',
  })
  .onChange(() => setGroundMaterial());
const environmentFolder = gui.addFolder('environment');
const showEnvironmentController = environmentFolder
  .add<any>(renderScene, 'showEnvironment')
  .onChange((value) => {
    if (value) {
      skyEnvironmentGUI.hideSky();
      backgroundEnvironmentGUI.hideBackground();
    }
  });
environmentFolder
  .add<any>(renderScene, 'environmentRotation', 0, Math.PI * 2, 0.01)
  .onChange((value) => {
    if (renderScene.scene.userData?.environmentDefinition) {
      renderScene.scene.userData.environmentDefinition.rotation = value;
    }
  });
environmentFolder
  .add<any>(renderScene, 'environmentIntensity', 0, 5, 0.01)
  .onChange((value) => {
    if (renderScene.scene.userData?.environmentDefinition) {
      renderScene.scene.userData.environmentDefinition.intensity = value;
    }
  });
const skyEnvironmentFolder = environmentFolder.addFolder('sky');
const skyEnvironmentGUI = new SkyEnvironmentGUI(renderScene.skyEnvironment);
skyEnvironmentGUI.addGUI(
  skyEnvironmentFolder,
  (skyEnvironment: SkyEnvironment) => {
    if (skyEnvironment.parameters.visible) {
      showEnvironmentController.setValue(false);
      showEnvironmentController.updateDisplay();
      backgroundEnvironmentGUI.hideBackground();
    }
  }
);
const backgroundEnvironmentFolder = environmentFolder.addFolder('background');
const backgroundEnvironmentGUI = new BackgroundEnvironmentGUI(
  renderScene.backgroundEnvironment
);
backgroundEnvironmentGUI.addGUI(
  backgroundEnvironmentFolder,
  (backgroundEnvironment: BackgroundEnvironment) => {
    if (backgroundEnvironment.parameters.isSet) {
      showEnvironmentController.setValue(false);
      showEnvironmentController.updateDisplay();
      skyEnvironmentGUI.hideSky();
    }
  }
);
renderScene.environmentLoader.addGUI(environmentFolder);
const sceneRendererGUI = new SceneRendererGUI(renderScene.sceneRenderer);
sceneRendererGUI.addGUI(gui, () => {});
const materialGUI = new MaterialGUI();
const lightFolder = gui.addFolder('Light');
const lightSourceGUI = new LightSourcesGUI(renderScene.getLightSources());
lightSourceGUI.addGUI(
  lightFolder,
  () => (on: boolean) => renderScene.changeLightControls(on),
  () => renderScene.updateSceneDependencies()
);

const onWindowResize = () => {
  const width = fixedResolution?.width ?? window.innerWidth;
  const height = fixedResolution?.height ?? window.innerHeight;
  renderScene.resize(width, height);
};
window.addEventListener('resize', onWindowResize, false);
const mousePosition = new Vector2();
const onPointerMove = (event: any) => {
  if (event.isPrimary === false) {
    return;
  }
  mousePosition.x = (event.clientX / window.innerWidth) * 2 - 1;
  mousePosition.y = -(event.clientY / window.innerHeight) * 2 + 1;
};
renderer.domElement.addEventListener('pointermove', onPointerMove);

setupDragDrop(
  'holder',
  'hover',
  (file: File, event: ProgressEvent<FileReader>) => {
    // @ts-ignore
    loadResource(file.name, event.target.result);
  }
);

const saveDocumentLink = document.createElement('a');
const saveSceneToFile = (fileName: string) => {
  const imgData = renderer.domElement.toDataURL();
  saveDocumentLink.href = imgData;
  saveDocumentLink.download = fileName;
  saveDocumentLink.click();
};
const renderAndSaveToFile = (renderMode: string, fileName: string) => {
  const renderModeBackup = renderScene.sceneRenderer.debugOutput;
  renderScene.sceneRenderer.debugOutput = renderMode;
  renderScene.prepareRender(new Vector2());
  renderScene.render(false);
  saveSceneToFile(fileName);
  renderScene.sceneRenderer.debugOutput = renderModeBackup;
};
const saveScene = () => {
  try {
    saveSceneToFile(generalProperties.sceneName + '.png');
  } catch (e) {
    console.log(e);
  }
};
const saveButton = document.getElementById('save-button');
if (saveButton) {
  saveButton.onclick = () => saveScene();
}
const saveGBuffer = () => {
  try {
    renderAndSaveToFile('color', generalProperties.sceneName + '_color.png');
    renderAndSaveToFile(
      'g-normal',
      generalProperties.sceneName + '_normal.png'
    );
    renderAndSaveToFile('g-depth', generalProperties.sceneName + '_depth.png');
  } catch (e) {
    console.log(e);
  }
};
const saveGBufferButton = document.getElementById('save-g-buffer-button');
if (saveGBufferButton) {
  saveGBufferButton.onclick = () => saveGBuffer();
}

let start: number;
let previousTimeStamp: number;
const animate = (timestamp: number) => {
  if (start === undefined) {
    start = timestamp;
  }
  if (previousTimeStamp === undefined) {
    previousTimeStamp = timestamp;
  }
  const elapsedMilliseconds = timestamp - previousTimeStamp;
  previousTimeStamp = timestamp;
  renderScene.animate(elapsedMilliseconds);
  //stats.begin();
  render();
  //stats.end();
  requestAnimationFrame(animate);
};

const render = () => {
  renderScene.prepareRender(mousePosition);
  renderScene.render();
  stats.update();
};

loadGlbFromMap('BrainStem');
requestAnimationFrame(animate);
