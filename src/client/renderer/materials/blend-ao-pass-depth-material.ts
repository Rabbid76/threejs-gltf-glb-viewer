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
import type { Nullable } from '../../utils/types';

const BlendAoPassDepthShader = {
  uniforms: {
    tDiffuse: { value: null as Nullable<Texture> },
  },
  vertexShader: `
          varying vec2 vUv;
    
          void main() {
              vUv = uv;
              gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
          }`,
  fragmentShader: `
          uniform highp sampler2D tDiffuse;
          varying vec2 vUv;
    
          void main() {
              vec4 textureColor = texture2D(tDiffuse, vUv);
              float aoPassDepth = dot(textureColor.wz, vec2(1.0/1024.0));
              gl_FragColor = vec4(vec3(aoPassDepth * aoPassDepth), 1.0);
          }`,
};

export interface BlendAoPassDepthMaterialParameters {
  texture?: Nullable<Texture>;
  blending?: Blending;
}

export class BlendAoPassDepthMaterial extends ShaderMaterial {
  private _intensity: Vector2 = new Vector2(1, 1);
  constructor(parameters?: BlendAoPassDepthMaterialParameters) {
    super({
      uniforms: UniformsUtils.clone(BlendAoPassDepthShader.uniforms),
      vertexShader: BlendAoPassDepthShader.vertexShader,
      fragmentShader: BlendAoPassDepthShader.fragmentShader,
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
    this.update(parameters);
  }

  public update(
    parameters?: BlendAoPassDepthMaterialParameters
  ): BlendAoPassDepthMaterial {
    if (parameters?.texture !== undefined) {
      this.uniforms.tDiffuse.value = parameters.texture;
    }
    if (parameters?.blending !== undefined) {
      this.blending = parameters.blending;
    }
    return this;
  }
}
