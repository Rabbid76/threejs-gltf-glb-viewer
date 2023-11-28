import type { SceneRenderer } from './scene-renderer';
import { QualityLevel } from './scene-renderer';
import { AmbientOcclusionType } from './shadow-and-ao-pass';
import {
  ACESFilmicToneMapping,
  CineonToneMapping,
  LinearSRGBColorSpace,
  LinearToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
  SRGBColorSpace,
} from 'three';
import type { GUI } from 'dat.gui';

export class SceneRendererGUI {
  private _sceneRenderer: SceneRenderer;
  private _qualityLevel = '';
  private _ambientOcclusionType = '';

  constructor(sceneRenderer: SceneRenderer) {
    this._sceneRenderer = sceneRenderer;
  }

  public addGUI(gui: GUI, updateCallback: () => void): void {
    this._addRepresentationalGUI(gui, updateCallback);
    this._addDebugGUI(gui, updateCallback);
    const shadowTypeFolder = gui.addFolder('Shadow type');
    this._addShadowTypeGUI(shadowTypeFolder, updateCallback);
    const shadowAndAoFolder = gui.addFolder('Shadow and Ambient Occlusion');
    this._addShadowAndAoGUI(shadowAndAoFolder, updateCallback);
    const groundReflectionFolder = gui.addFolder('Ground Reflection');
    this._addGroundReflectionGUI(groundReflectionFolder, updateCallback);
    const bakedGroundContactShadowFolder = gui.addFolder(
      'Baked Ground Contact Shadow'
    );
    this._addBakedGroundContactShadowGUI(
      bakedGroundContactShadowFolder,
      updateCallback
    );
    const outlineFolder = gui.addFolder('Outline');
    this._addOutlineGUI(outlineFolder, updateCallback);
  }

  private _addRepresentationalGUI(gui: GUI, updateCallback: () => void): void {
    const outputColorSpaces = new Map([
      ['LinearSRGBColorSpace', LinearSRGBColorSpace],
      ['SRGBColorSpace', SRGBColorSpace],
    ]);
    const outputColorSpaceNames: string[] = [];
    outputColorSpaces.forEach((value, key) => {
      outputColorSpaceNames.push(key);
      if (this._sceneRenderer.renderer.outputColorSpace === value) {
        this._sceneRenderer.outputColorSpace = key;
      }
    });
    gui
      .add<any>(this._sceneRenderer, 'outputColorSpace', outputColorSpaceNames)
      .onChange((colorSpace: string) => {
        if (outputColorSpaces.has(colorSpace)) {
          this._sceneRenderer.renderer.outputColorSpace =
            outputColorSpaces.get(colorSpace) ?? SRGBColorSpace;
          updateCallback();
        }
      });
    const toneMappings = new Map([
      ['NoToneMapping', NoToneMapping],
      ['LinearToneMapping', LinearToneMapping],
      ['ReinhardToneMapping', ReinhardToneMapping],
      ['CineonToneMapping', CineonToneMapping],
      ['ACESFilmicToneMapping', ACESFilmicToneMapping],
    ]);
    const toneMappingNames: string[] = [];
    toneMappings.forEach((value, key) => {
      toneMappingNames.push(key);
      if (this._sceneRenderer.renderer.toneMapping === value) {
        this._sceneRenderer.toneMapping = key;
      }
    });
    gui
      .add<any>(this._sceneRenderer, 'toneMapping', toneMappingNames)
      .onChange((toneMapping: string) => {
        if (toneMappings.has(toneMapping)) {
          this._sceneRenderer.renderer.toneMapping =
            toneMappings.get(toneMapping) ?? NoToneMapping;
          updateCallback();
        }
      });
  }

  private _addDebugGUI(gui: GUI, updateCallback: () => void): void {
    const qualityLevels = new Map([
      ['HIGHEST', QualityLevel.HIGHEST],
      ['HIGH', QualityLevel.HIGH],
      ['MEDIUM', QualityLevel.MEDIUM],
      ['LOW', QualityLevel.LOW],
    ]);
    const outputQualityNames: string[] = [];
    qualityLevels.forEach((value, key) => outputQualityNames.push(key));
    gui
      .add<any>(this, '_qualityLevel', outputQualityNames)
      .onChange((qualityLevel: string) => {
        if (qualityLevels.has(qualityLevel)) {
          this._sceneRenderer.setQualityLevel(
            qualityLevels.get(qualityLevel) ?? QualityLevel.HIGHEST
          );
        }
      });
    gui
      .add<any>(this._sceneRenderer, 'debugOutput', {
        'off ': 'off',
        'grayscale (no textures)': 'grayscale',
        'color buffer': 'color',
        'linear depth': 'lineardepth',
        'g-buffer normal vector': 'g-normal',
        'g-buffer depth': 'g-depth',
        'AO pure': 'ssao',
        'AO denoised': 'ssaodenoise',
        'shadow map': 'shadowmap',
        'shadow Monte Carlo': 'shadow',
        'shadow blur': 'shadowblur',
        'shadow fade in': 'shadowfadein',
        'shadow and AO': 'shadowandao',
        'ground reflection': 'groundreflection',
        'baked ground shadow': 'bakedgroundshadow',
        'selection outline': 'outline',
        'environment map': 'environmentmap',
        'light source detection': 'lightsourcedetection',
      })
      .onChange(() => updateCallback());
  }

  private _addShadowTypeGUI(gui: GUI, updateCallback: () => void): void {
    const shadowConfiguration =
      this._sceneRenderer.screenSpaceShadow.shadowConfiguration;
    const shadowMapNames: any[] = [];
    shadowConfiguration.types.forEach((_, key) => {
      shadowMapNames.push(key);
    });
    const updateShadow = () => {
      this._sceneRenderer.screenSpaceShadow.needsUpdate = true;
      this._sceneRenderer.screenSpaceShadow.shadowTypeNeedsUpdate = true;
      this._sceneRenderer.shadowAndAoPass.needsUpdate = true;
      updateCallback();
    };
    gui
      .add<any>(shadowConfiguration, 'shadowType', shadowMapNames)
      .onChange((type: string) => {
        if (this._sceneRenderer.screenSpaceShadow.switchType(type)) {
          shadowBiasController.object =
            shadowConfiguration.currentConfiguration;
          shadowNormalBiasController.object =
            shadowConfiguration.currentConfiguration;
          shadowRadiusController.object =
            shadowConfiguration.currentConfiguration;
          shadowBiasController.updateDisplay();
          shadowNormalBiasController.updateDisplay();
          shadowRadiusController.updateDisplay();
          updateShadow();
        }
      });
    const shadowBiasController = gui
      .add<any>(
        shadowConfiguration.currentConfiguration,
        'bias',
        -0.001,
        0.001,
        0.00001
      )
      .onChange(() => updateShadow());
    const shadowNormalBiasController = gui
      .add<any>(
        shadowConfiguration.currentConfiguration,
        'normalBias',
        -0.05,
        0.05
      )
      .onChange(() => updateShadow());
    const shadowRadiusController = gui
      .add<any>(shadowConfiguration.currentConfiguration, 'radius', 0, 100)
      .onChange(() => updateShadow());
  }

  private _addShadowAndAoGUI(gui: GUI, updateCallback: () => void): void {
    const updateParameters = (): void => {
      this._sceneRenderer.gBufferRenderTarget.needsUpdate = true;
      this._sceneRenderer.screenSpaceShadow.needsUpdate = true;
      this._sceneRenderer.shadowAndAoPass.needsUpdate = true;
      this._sceneRenderer.shadowAndAoPass.shadowAndAoRenderTargets.parametersNeedsUpdate =
        true;
      updateCallback();
    };
    const parameters = this._sceneRenderer.shadowAndAoPass.parameters;
    const ahAndAoParameters = parameters.shAndAo;
    const shadowMapParameters =
      this._sceneRenderer.screenSpaceShadow.parameters;
    const hbaoParameters = parameters.hbao;
    const denoiseParameters = parameters.poissonDenoise;
    gui.add<any>(parameters, 'enabled').onChange(() => updateParameters());
    const aoTypes = new Map([
      ['none', AmbientOcclusionType.NONE],
      ['SSAO', AmbientOcclusionType.SSAO],
      ['HBAO', AmbientOcclusionType.HBAO],
    ]);
    const aoNames: string[] = Array.from(aoTypes.keys());
    aoTypes.forEach((value, key) => {
      if (value === parameters.aoType) {
        this._ambientOcclusionType = key;
      }
    });
    gui
      .add<any>(this, '_ambientOcclusionType', aoNames)
      .onChange((aoType: string) => {
        if (aoTypes.has(aoType)) {
          parameters.aoType = aoTypes.get(aoType) ?? AmbientOcclusionType.SSAO;
          updateParameters();
        }
      });
    gui.add<any>(parameters, 'aoIntensity', 0, 1).onChange(() => {
      updateParameters();
    });
    gui.add<any>(parameters, 'aoOnGround').onChange(() => {
      updateParameters();
      this._sceneRenderer.clearCache();
    });
    gui.add<any>(parameters, 'shadowOnGround').onChange(() => {
      updateParameters();
      this._sceneRenderer.clearCache();
    });
    gui
      .add<any>(parameters, 'shadowIntensity', 0, 1)
      .onChange(() => updateParameters());
    gui.add<any>(parameters, 'alwaysUpdate').onChange(() => updateParameters());
    gui
      .add<any>(parameters, 'progressiveDenoiseIterations', 0, 3, 1)
      .onChange(() => updateParameters());

    const shFolder = gui.addFolder('Shadow and Monte Carlo integration');
    shFolder
      .add<any>(shadowMapParameters, 'maximumNumberOfLightSources')
      .onChange(() => updateParameters());
    shFolder
      .add<any>(shadowMapParameters, 'directionalDependency', 0.0, 1.0, 0.01)
      .onChange(() => updateParameters());
    shFolder
      .add<any>(shadowMapParameters, 'directionalExponent', 0.0, 2.0, 0.01)
      .onChange(() => updateParameters());
    shFolder
      .add<any>(shadowMapParameters, 'groundContainment', 0.0, 1.0, 0.01)
      .onChange(() => updateParameters());
    shFolder
      .add<any>(shadowMapParameters, 'fadeOutDistance', 0.0, 5.0, 0.01)
      .onChange(() => updateParameters());
    shFolder
      .add<any>(shadowMapParameters, 'fadeOutBlur', 0.0, 100.0)
      .onChange(() => updateParameters());
    shFolder
      .add<any>(ahAndAoParameters, 'shadowRadius', 0.001, 0.5)
      .onChange(() => updateParameters());
    const aoFolder = gui.addFolder('SSAO');
    aoFolder
      .add<any>(ahAndAoParameters, 'aoFadeout', 0, 1)
      .onChange(() => updateParameters());
    aoFolder
      .add<any>(ahAndAoParameters, 'aoKernelRadius', 0.001, 1)
      .onChange(() => updateParameters());
    aoFolder
      .add<any>(ahAndAoParameters, 'aoDepthBias', 0.0001, 0.01)
      .onChange(() => updateParameters());
    aoFolder
      .add<any>(ahAndAoParameters, 'aoMaxDistance', 0.01, 1)
      .onChange(() => updateParameters());
    aoFolder
      .add<any>(ahAndAoParameters, 'aoMaxDepth', 0.9, 1)
      .onChange(() => updateParameters());

    const hbaoFolder = gui.addFolder('HBAO');
    hbaoFolder
      .add<any>(hbaoParameters, 'samples', 1, 64, 1)
      .onChange(() => updateParameters());
    hbaoFolder
      .add<any>(hbaoParameters, 'radius', 0.1, 10, 0.01)
      .onChange(() => updateParameters());
    hbaoFolder
      .add<any>(hbaoParameters, 'distanceExponent', 0.1, 5, 0.1)
      .onChange(() => updateParameters());
    hbaoFolder
      .add<any>(hbaoParameters, 'bias', 0.001, 0.1, 0.001)
      .onChange(() => updateParameters());

    const denoiseFolder = gui.addFolder('Possion Denoise');
    denoiseFolder
      .add<any>(denoiseParameters, 'iterations', 0, 3, 1)
      .onChange(() => updateParameters());
    denoiseFolder
      .add<any>(denoiseParameters, 'radius', 0, 50, 1)
      .onChange(() => updateParameters());
    denoiseFolder
      .add<any>(denoiseParameters, 'radiusExponent', 0.1, 4, 0.01)
      .onChange(() => updateParameters());
    denoiseFolder
      .add<any>(denoiseParameters, 'rings', 0, 16, 0.125)
      .onChange(() => updateParameters());
    denoiseFolder
      .add<any>(denoiseParameters, 'samples', 0, 32, 1)
      .onChange(() => updateParameters());
    denoiseFolder
      .add<any>(denoiseParameters, 'lumaPhi', 0, 20, 0.001)
      .onChange(() => updateParameters());
    denoiseFolder
      .add<any>(denoiseParameters, 'depthPhi', 0, 20, 0.001)
      .onChange(() => updateParameters());
    denoiseFolder
      .add<any>(denoiseParameters, 'normalPhi', 0, 20, 0.001)
      .onChange(() => updateParameters());
  }

  private _addGroundReflectionGUI(gui: GUI, updateCallback: () => void): void {
    const parameters =
      this._sceneRenderer.parameters.groundReflectionParameters;
    gui.add<any>(parameters, 'enabled');
    gui
      .add<any>(parameters, 'intensity', 0.0, 1.0)
      .onChange(() => updateCallback());
    gui
      .add<any>(parameters, 'fadeOutDistance', 0.0, 4.0)
      .onChange(() => updateCallback());
    gui
      .add<any>(parameters, 'fadeOutExponent', 0.1, 10.0)
      .onChange(() => updateCallback());
    gui
      .add<any>(parameters, 'brightness', 0.0, 2.0)
      .onChange(() => updateCallback());
    gui
      .add<any>(parameters, 'blurHorizontal', 0.0, 10.0)
      .onChange(() => updateCallback());
    gui
      .add<any>(parameters, 'blurVertical', 0.0, 10.0)
      .onChange(() => updateCallback());
  }

  private _addBakedGroundContactShadowGUI(
    gui: GUI,
    updateCallback: () => void
  ): void {
    const updateParameters = (): void => {
      this._sceneRenderer.bakedGroundContactShadow.applyParameters();
      updateCallback();
    };
    const parameters =
      this._sceneRenderer.parameters.bakedGroundContactShadowParameters;
    gui.add<any>(parameters, 'enabled');
    gui.add<any>(parameters, 'cameraHelper').onChange(() => updateParameters());
    gui.add<any>(parameters, 'alwaysUpdate');
    gui.add<any>(parameters, 'fadeIn');
    gui
      .add<any>(parameters, 'blurMin', 0, 0.2, 0.001)
      .onChange(() => updateParameters());
    gui
      .add<any>(parameters, 'blurMax', 0, 0.5, 0.01)
      .onChange(() => updateParameters());
    gui
      .add<any>(parameters, 'fadeoutFalloff', 0.0, 1.0, 0.01)
      .onChange(() => updateParameters());
    gui
      .add<any>(parameters, 'fadeoutBias', 0.0, 0.5)
      .onChange(() => updateParameters());
    gui
      .add<any>(parameters, 'opacity', 0, 1, 0.01)
      .onChange(() => updateParameters());
    gui
      .add<any>(parameters, 'maximumPlaneSize', 0, 50, 1)
      .onChange(() => updateParameters());
    gui
      .add<any>(parameters, 'cameraFar', 0.1, 10, 0.1)
      .onChange(() => updateParameters());
  }

  private _addOutlineGUI(gui: GUI, updateCallback: () => void): void {
    const updateOutlineParameters = (): void => {
      this._sceneRenderer.outlineRenderer.applyParameters();
      updateCallback();
    };
    const parameters = this._sceneRenderer.outlineRenderer.parameters;
    gui.add<any>(parameters, 'enabled');
    gui
      .add<any>(parameters, 'edgeStrength', 0.5, 20)
      .onChange(() => updateOutlineParameters());
    gui
      .add<any>(parameters, 'edgeGlow', 0, 20)
      .onChange(() => updateOutlineParameters());
    gui
      .add<any>(parameters, 'edgeThickness', 0.5, 20)
      .onChange(() => updateOutlineParameters());
    gui
      .add<any>(parameters, 'pulsePeriod', 0, 5)
      .onChange(() => updateOutlineParameters());
    gui
      .addColor(parameters, 'visibleEdgeColor')
      .onChange(() => updateOutlineParameters());
    gui
      .addColor(parameters, 'hiddenEdgeColor')
      .onChange(() => updateOutlineParameters());
  }
}
