import type { Blending, Texture } from 'three';
import {
  AddEquation,
  DstAlphaFactor,
  DstColorFactor,
  ShaderMaterial,
  UniformsUtils,
  Vector2,
  ZeroFactor,
} from 'three';

const BlendAoAndAShadowShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    intensity: { value: new Vector2(1, 1) },
  },
  vertexShader: `
          varying vec2 vUv;
    
          void main() {
              vUv = uv;
              gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
          }`,
  fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform vec2 intensity;
          varying vec2 vUv;
    
          void main() {
              vec4 textureColor = texture2D(tDiffuse, vUv);
              vec2 aoAndShadow = vec2(1.0) - intensity + intensity * textureColor.rg;
              gl_FragColor = vec4(vec3(aoAndShadow.r * aoAndShadow.g), 1.0);
          }`,
};

export interface BlendAoAndAShadowMaterialParameters {
  texture?: Texture | null;
  blending?: Blending;
  aoIntensity?: number;
  shadowIntensity?: number;
}

export class BlendAoAndAShadowMaterial extends ShaderMaterial {
  private _intensity: Vector2 = new Vector2(1, 1);
  constructor(parameters?: BlendAoAndAShadowMaterialParameters) {
    super({
      uniforms: UniformsUtils.clone(BlendAoAndAShadowShader.uniforms),
      vertexShader: BlendAoAndAShadowShader.vertexShader,
      fragmentShader: BlendAoAndAShadowShader.fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blendSrc: DstColorFactor,
      blendDst: ZeroFactor,
      blendEquation: AddEquation,
      blendSrcAlpha: DstAlphaFactor,
      blendDstAlpha: ZeroFactor,
      blendEquationAlpha: AddEquation,
    });
    this.uniforms.intensity.value = this._intensity;
    this.update(parameters);
  }

  public update(
    parameters?: BlendAoAndAShadowMaterialParameters
  ): BlendAoAndAShadowMaterial {
    if (parameters?.texture !== undefined) {
      this.uniforms.tDiffuse.value = parameters?.texture;
    }
    if (parameters?.blending !== undefined) {
      this.blending = parameters?.blending;
    }
    if (parameters?.aoIntensity !== undefined) {
      this._intensity.x = parameters?.aoIntensity;
    }
    if (parameters?.shadowIntensity !== undefined) {
      this._intensity.y = parameters?.shadowIntensity;
    }
    return this;
  }
}
