import { RenderPass } from './render-pass';
import type { RenderPassManager } from '../render-pass-manager';
import type { CopyTransformMaterialParameters } from '../shader-utility';
import {
  ALPHA_RGBA,
  ALPHA_TRANSFORM,
  CopyTransformMaterial,
  COLOR_COPY_BLEND_MODES,
  DEFAULT_TRANSFORM,
  DEFAULT_UV_TRANSFORM,
  FLIP_Y_UV_TRANSFORM,
  GRAYSCALE_TRANSFORM,
  interpolationMatrix,
  LinearDepthRenderMaterial,
  RED_TRANSFORM,
  RGB_TRANSFORM,
  ZERO_RGBA,
} from '../shader-utility';
import { ShadowAndAoPass } from './shadow-and-ao-pass';
import { EnvironmentMapDecodeMaterial } from '../light-source-detection';
import type { Camera, ShaderMaterial, Texture, WebGLRenderer } from 'three';
import { Color, Matrix4, NoBlending, OrthographicCamera, Vector4 } from 'three';

export class DebugPass extends RenderPass {
  private _environmentMapDecodeMaterial: EnvironmentMapDecodeMaterial;
  private _copyMaterial?: CopyTransformMaterial;
  private _srgbToLinearCopyMaterial?: CopyTransformMaterial;
  private _depthRenderMaterial?: LinearDepthRenderMaterial;
  public debugOutput: string = '';

  constructor(renderPassManager: RenderPassManager) {
    super(renderPassManager);
    this._environmentMapDecodeMaterial = new EnvironmentMapDecodeMaterial(
      true,
      false
    );
    this._environmentMapDecodeMaterial.blending = NoBlending;
    this._environmentMapDecodeMaterial.depthTest = false;
  }

  public dispose(): void {
    this._depthRenderMaterial?.dispose();
    this._copyMaterial?.dispose();
    this._srgbToLinearCopyMaterial?.dispose();
  }

  protected getCopyMaterial(
    parameters?: CopyTransformMaterialParameters
  ): ShaderMaterial {
    this._copyMaterial = this._copyMaterial ?? new CopyTransformMaterial();
    return this._copyMaterial.update(parameters);
  }

  protected getSrgbToLinearCopyMaterial(
    parameters?: CopyTransformMaterialParameters
  ): ShaderMaterial {
    this._srgbToLinearCopyMaterial =
      this._copyMaterial ??
      new CopyTransformMaterial(
        {},
        COLOR_COPY_BLEND_MODES.ADDITIVE,
        true,
        true
      );
    return this._srgbToLinearCopyMaterial.update(parameters);
  }

  private _getDepthRenderMaterial(camera: Camera): LinearDepthRenderMaterial {
    this._depthRenderMaterial =
      this._depthRenderMaterial ??
      new LinearDepthRenderMaterial({
        depthTexture: this.gBufferTextures.textureWithDepthValue,
        depthFilter: this.gBufferTextures.isFloatGBufferWithRgbNormalAlphaDepth
          ? new Vector4(0, 0, 0, 1)
          : new Vector4(1, 0, 0, 0),
      });
    return this._depthRenderMaterial.update({ camera });
  }

  // eslint-disable-next-line complexity
  public renderPass(renderer: WebGLRenderer): void {
    switch (this.debugOutput) {
      default:
        break;
      case 'lineardepth':
        this.passRenderer.renderScreenSpace(
          renderer,
          this._getDepthRenderMaterial(this.camera),
          null
        );
        break;
      case 'g-normal':
        if (this.gBufferTextures.isFloatGBufferWithRgbNormalAlphaDepth) {
          this.passRenderer.renderScreenSpace(
            renderer,
            this.getCopyMaterial({
              texture: this.gBufferTextures?.gBufferTexture,
              blending: NoBlending,
              // prettier-ignore
              colorTransform: new Matrix4().set(
                  0.5, 0, 0, 0,
                  0, 0.5, 0, 0,
                  0, 0, 0.5, 0,
                  0, 0, 0, 0,
              ),
              colorBase: new Vector4(0.5, 0.5, 0.5, 1),
              multiplyChannels: 0,
              uvTransform: DEFAULT_UV_TRANSFORM,
            }),
            null
          );
        } else {
          this.passRenderer.renderScreenSpace(
            renderer,
            this.getCopyMaterial({
              texture: this.gBufferTextures?.gBufferTexture,
              blending: NoBlending,
              colorTransform: RGB_TRANSFORM,
              colorBase: ALPHA_RGBA,
              multiplyChannels: 0,
              uvTransform: DEFAULT_UV_TRANSFORM,
            }),
            null
          );
        }
        break;
      case 'g-depth':
        if (this.gBufferTextures.isFloatGBufferWithRgbNormalAlphaDepth) {
          this.passRenderer.renderScreenSpace(
            renderer,
            this.getCopyMaterial({
              texture: this.gBufferTextures?.gBufferTexture,
              blending: NoBlending,
              colorTransform: ALPHA_TRANSFORM,
              colorBase: ALPHA_RGBA,
              multiplyChannels: 0,
              uvTransform: DEFAULT_UV_TRANSFORM,
            }),
            null
          );
        } else {
          this.passRenderer.renderScreenSpace(
            renderer,
            this.getCopyMaterial({
              texture: this.gBufferTextures?.depthBufferTexture,
              blending: NoBlending,
              colorTransform: RED_TRANSFORM,
              colorBase: ALPHA_RGBA,
              multiplyChannels: 0,
              uvTransform: DEFAULT_UV_TRANSFORM,
            }),
            null
          );
        }
        break;
      case 'ssao':
        this.passRenderer.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture:
              this.renderPassManager.shadowAndAoPass.aoAndSoftShadowRenderTarget
                .texture,
            blending: NoBlending,
            colorTransform: GRAYSCALE_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'ssaodenoise':
        this.passRenderer.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture:
              this.renderPassManager.shadowAndAoPass.denoiseRenderTargetTexture,
            blending: NoBlending,
            colorTransform: GRAYSCALE_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'shadowmap':
        this.passRenderer.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture:
              this.renderPassManager.screenSpaceShadowMapPass.shadowTexture,
            blending: NoBlending,
            colorTransform: GRAYSCALE_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'shadowsoft':
        this.passRenderer.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture:
              this.renderPassManager.shadowAndAoPass.aoAndSoftShadowRenderTarget
                .texture,
            blending: NoBlending,
            colorTransform: ShadowAndAoPass.shadowTransform,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'shadowdenoise':
        this.passRenderer.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture:
              this.renderPassManager.shadowAndAoPass.denoiseRenderTargetTexture,
            blending: NoBlending,
            colorTransform: ShadowAndAoPass.shadowTransform,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'shadowfadein':
        this.passRenderer.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture:
              this.renderPassManager.shadowAndAoPass.fadeRenderTarget.texture,
            blending: NoBlending,
            colorTransform: ShadowAndAoPass.shadowTransform,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'shadowandao':
        this.passRenderer.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture:
              this.renderPassManager.shadowAndAoPass.denoiseRenderTargetTexture,
            blending: NoBlending,
            colorTransform: interpolationMatrix(
              this.renderPassManager.shadowAndAoPass.parameters.aoIntensity,
              this.renderPassManager.shadowAndAoPass.parameters.shadowIntensity,
              0,
              0
            ),
            colorBase: ALPHA_RGBA,
            multiplyChannels: 1,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'materialao':
        this.passRenderer.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture: this.renderPassManager.aoPassMapTexture,
            blending: NoBlending,
            colorTransform: DEFAULT_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'groundreflection':
        this.passRenderer.renderScreenSpace(
          renderer,
          this.getSrgbToLinearCopyMaterial({
            texture:
              this.renderPassManager.groundReflectionPass.reflectionRenderTarget
                .texture,
            blending: NoBlending,
            colorTransform: DEFAULT_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: FLIP_Y_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'groundreflectionfinal':
        this.passRenderer.renderScreenSpace(
          renderer,
          this.getSrgbToLinearCopyMaterial({
            texture:
              this.renderPassManager.groundReflectionPass.intensityRenderTarget
                .texture,
            blending: NoBlending,
            colorTransform: DEFAULT_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: FLIP_Y_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'bakedgroundshadow':
        this.passRenderer.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture:
              this.renderPassManager.bakedGroundContactShadowPass.renderTarget
                .texture,
            blending: NoBlending,
            colorTransform: DEFAULT_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'environmentmap':
        this._environmentMapDecodeMaterial.setSourceTexture(
          this.scene.environment as Texture
        );
        this.passRenderer.renderScreenSpace(
          renderer,
          this._environmentMapDecodeMaterial,
          null
        );
        break;
      case 'lightsourcedetection':
        if (this.scene.userData?.environmentDefinition) {
          const aspect = this.renderPassManager.aspect;
          const environmentCamera = new OrthographicCamera(
            -1,
            1,
            1 / aspect,
            -1 / aspect,
            -1,
            1
          );
          const environmentScene =
            this.scene.userData?.environmentDefinition.createDebugScene(
              renderer,
              this.scene,
              this.renderPassManager.screenSpaceShadowMapPass.parameters
                .maximumNumberOfLightSources
            );
          environmentScene.background = new Color(0xffffff);
          renderer.render(environmentScene, environmentCamera);
        }
        break;
    }
  }
}
