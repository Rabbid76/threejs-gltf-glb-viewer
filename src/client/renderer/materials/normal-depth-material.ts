import type {
  Camera,
  Shader,
  WebGLRenderer,
  OrthographicCamera,
  PerspectiveCamera,
} from 'three';
import { MeshNormalMaterial, Vector2 } from 'three';

interface ThreeShader {
  defines?: { [key: string]: any };
  uniforms?: { [key: string]: any };
}

export class GBufferNormalDepthMaterial extends MeshNormalMaterial {
  private _floatRgbNormalAlphaDepth;
  private _linearDepth;
  private _cameraNearFar = new Vector2(0, 1);

  constructor(parameters?: any) {
    super(parameters);
    this._floatRgbNormalAlphaDepth =
      parameters.floatRgbNormalAlphaDepth ?? true;
    this._linearDepth = parameters.linearDepth ?? false;
    this.onBeforeCompile = this._onBeforeCompile;
  }

  public updateCameraDependentUniforms(camera: Camera) {
    const sceneCamera = camera as OrthographicCamera | PerspectiveCamera;
    this._cameraNearFar.set(sceneCamera.near, sceneCamera.far);
  }

  private _onBeforeCompile(materialShader: Shader, _renderer: WebGLRenderer) {
    materialShader.vertexShader = normalMaterialVertexShader;
    materialShader.fragmentShader = normalMaterialFragmentShader;
    (materialShader as ThreeShader).defines = Object.assign({
      ...(materialShader as ThreeShader).defines,
      FLOAT_NORMAL_DEPTH_BUFFER: this._floatRgbNormalAlphaDepth ? 1 : 0,
      LINEAR_DEPTH: this._linearDepth ? 1 : 0,
    });
    const uniforms = (materialShader as ThreeShader).uniforms;
    if (uniforms) {
      uniforms.cameraNearFar = { value: this._cameraNearFar };
    }
  }
}

const normalMaterialVertexShader = `
#define NORMAL

#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )

	varying vec3 vViewPosition;

#endif

#include <common>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

#if LINEAR_DEPTH == 1
    varying float vZ;  
#endif

void main() {

	#include <uv_vertex>

	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>

	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )

	vViewPosition = - mvPosition.xyz;

#endif

#if LINEAR_DEPTH == 1
    vZ = -mvPosition.z;  
#endif

}
`;

const normalMaterialFragmentShader = `
#define NORMAL

uniform float opacity;

#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )

	varying vec3 vViewPosition;

#endif

#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

#if LINEAR_DEPTH == 1
  varying float vZ;  
  uniform vec2 cameraNearFar;
#endif

void main() {

	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>

#if FLOAT_NORMAL_DEPTH_BUFFER == 1
    
  vec3 normalVector = normalize(normal);    
#if LINEAR_DEPTH == 1
  float depth = (-vZ - cameraNearFar.x) / (cameraNearFar.y - cameraNearFar.x);
#else
  float depth = gl_FragCoord.z;
#endif
  gl_FragColor = vec4(normalVector, depth);

#else

  vec3 normalVector = packNormalToRGB(normal);    
#ifdef OPAQUE
  opacity = 1.0;
#endif
  gl_FragColor = vec4(normalVector, opacity);

#endif

}
`;
