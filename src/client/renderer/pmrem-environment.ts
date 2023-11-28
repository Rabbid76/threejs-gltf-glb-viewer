import type { Texture, WebGLRenderer, WebGLRenderTarget } from 'three';
import { Matrix3, NoBlending, PMREMGenerator, ShaderMaterial } from 'three';

interface WithEquirectMaterial {
  _equirectMaterial: ShaderMaterial | null;
}

export class EnvironmentPmremGenertor extends PMREMGenerator {
  private _extendedEquirectMaterial: ShaderMaterial;

  constructor(renderer: WebGLRenderer) {
    super(renderer);
    this._extendedEquirectMaterial = this._createEquirectMaterial();
  }

  public fromEquirectangularTexture(
    equirectangularTexture: Texture,
    parameters?: { rotation?: number; intensity?: number }
  ): WebGLRenderTarget {
    const rotation = parameters?.rotation ?? 0;
    const intensity = parameters?.intensity ?? 1;
    this._extendedEquirectMaterial.uniforms.intensity.value = intensity;
    // prettier-ignore
    this._extendedEquirectMaterial.uniforms.rotationMatrix.value.set(
      Math.cos(rotation), 0, -Math.sin(rotation),
      0, 1, 0,
      Math.sin(rotation), 0, Math.cos(rotation)
    );
    return super.fromEquirectangular(equirectangularTexture);
  }

  private _createEquirectMaterial(): ShaderMaterial {
    const material = new ShaderMaterial({
      name: 'EquirectangularToCubeUV',
      uniforms: {
        envMap: { value: null },
        intensity: { value: 1.0 },
        rotationMatrix: { value: new Matrix3() },
      },
      vertexShader: equilateralVertexShader,
      fragmentShader: equilateralFragmentShader,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    (this as unknown as WithEquirectMaterial)._equirectMaterial = material;
    return material;
  }
}

const equilateralVertexShader = `
precision mediump float;
precision mediump int;
attribute float faceIndex;
varying vec3 vOutputDirection;
uniform mat3 rotationMatrix;

// RH coordinate system; PMREM face-indexing convention
vec3 getDirection( vec2 uv, float face ) {
    uv = 2.0 * uv - 1.0;
    vec3 direction = vec3( uv, 1.0 );
    if ( face == 0.0 ) {
        direction = direction.zyx; // ( 1, v, u ) pos x
    } else if ( face == 1.0 ) {
        direction = direction.xzy;
        direction.xz *= -1.0; // ( -u, 1, -v ) pos y
    } else if ( face == 2.0 ) {
        direction.x *= -1.0; // ( -u, v, 1 ) pos z
    } else if ( face == 3.0 ) {
        direction = direction.zyx;
        direction.xz *= -1.0; // ( -1, v, -u ) neg x
    } else if ( face == 4.0 ) {
        direction = direction.xzy;
        direction.xy *= -1.0; // ( -u, -1, v ) neg y
    } else if ( face == 5.0 ) {
        direction.z *= -1.0; // ( u, v, -1 ) neg z
    }
    return direction;
}

void main() {
    vOutputDirection = rotationMatrix * getDirection(uv, faceIndex);
    gl_Position = vec4(position, 1.0);
}
`;

const equilateralFragmentShader = `
precision mediump float;
precision mediump int;
varying vec3 vOutputDirection;
uniform sampler2D envMap;
uniform float intensity;

#include <common>

void main() {    
    vec3 outputDirection = normalize(vOutputDirection);
    vec2 uv = equirectUv(outputDirection);
    gl_FragColor = vec4(texture2D(envMap, uv).rgb * intensity, 1.0);
}
`;
