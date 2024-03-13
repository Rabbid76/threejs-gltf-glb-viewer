import type {
  MeshPhysicalMaterial,
  ShaderLibShader,
  Texture,
  WebGLRenderer,
} from 'three';

export class PostProcessingMaterialPlugin {
  private _aoPassMap: Texture | null = null;
  public aoPassMapScale: number = 1;
  public aoIntensity: number = 1;
  public aoPassMapIntensity: number = 1;
  public shPassMapIntensity: number = 1;
  public applyAoAndShadowToAlpha: boolean = false;
  private _material: MeshPhysicalMaterial;
  private _materialShader: ShaderLibShader | null = null;

  get aoPassMap(): Texture | null {
    return this._aoPassMap;
  }

  set aoPassMap(aoPassMap: Texture | null) {
    this._aoPassMap = aoPassMap;
    this._material.needsUpdate = true;
    this._setUniforms();
  }

  public static addPlugin(
    material: MeshPhysicalMaterial
  ): PostProcessingMaterialPlugin | null {
    if (material.userData.postProcessingMaterialPlugin !== undefined) {
      return material.userData.postProcessingMaterialPlugin instanceof
        PostProcessingMaterialPlugin
        ? material.userData.postProcessingMaterialPlugin
        : null;
    }
    const plugin = new PostProcessingMaterialPlugin(material);
    material.userData.postProcessingMaterialPlugin = plugin;
    material.onBeforeCompile = (
      materialShader: ShaderLibShader,
      renderer: WebGLRenderer
    ) => plugin._onBeforeCompile(materialShader, renderer);
    material.customProgramCacheKey = () => plugin._customProgramCacheKey();
    return plugin;
  }

  constructor(material: MeshPhysicalMaterial) {
    this._material = material;
  }

  private _customProgramCacheKey() {
    return this._aoPassMap !== undefined && this._aoPassMap !== null
      ? 'aoPassMap' + (this.applyAoAndShadowToAlpha ? 'Alpha' : '')
      : '';
  }

  private _onBeforeCompile(
    materialShader: ShaderLibShader,
    _renderer: WebGLRenderer
  ) {
    this._materialShader = materialShader;

    if (this._aoPassMap !== undefined && this._aoPassMap !== null) {
      let parsReplacement: string = this.applyAoAndShadowToAlpha
        ? '#define USE_APPLY_AO_AND_SHADOW_TO_ALPHA\n'
        : '';
      parsReplacement += aoMapParsFragmentReplacement;
      this._materialShader.fragmentShader =
        this._materialShader.fragmentShader.replace(
          '#include <aomap_pars_fragment>',
          parsReplacement
        );
      this._materialShader.fragmentShader =
        this._materialShader.fragmentShader.replace(
          '#include <aomap_fragment>',
          aoMapFragmentReplacement
        );
    }

    this._setUniforms();
  }

  private _setUniforms() {
    if (this._materialShader) {
      this._materialShader.uniforms.tAoPassMap = { value: this._aoPassMap };
      this._materialShader.uniforms.aoPassMapScale = {
        value: this.aoPassMapScale,
      };
      this._materialShader.uniforms.aoPassMapIntensity = {
        value: this.aoPassMapIntensity,
      };
      this._materialShader.uniforms.shPassMapIntensity = {
        value: this.shPassMapIntensity,
      };
    }
  }
}

const aoMapParsFragmentReplacement = /* glsl */ `
#ifdef USE_AOMAP

	uniform sampler2D aoMap;
	uniform float aoMapIntensity;

#endif

	uniform sampler2D tAoPassMap;
	uniform float aoPassMapScale;
  uniform float aoPassMapIntensity;
  uniform float shPassMapIntensity;
`;

const aoMapFragmentReplacement = /* glsl */ `
#ifndef AOPASSMAP_SWIZZLE
	#define AOPASSMAP_SWIZZLE rg
#endif

float ambientOcclusion = 1.0;
float shadowValue = 1.0;
	
#ifdef USE_AOMAP

	// reads channel R, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
	ambientOcclusion = texture2D( aoMap, vAoMapUv ).r;
  ambientOcclusion = ( ambientOcclusion - 1.0 ) * aoMapIntensity + 1.0;

#endif

  vec2 aoAndShadow = texelFetch( tAoPassMap, ivec2( gl_FragCoord.xy * aoPassMapScale ), 0 ).rg;
  float aoPassMapValue = max(0.0, (aoAndShadow.r - 1.0) * aoPassMapIntensity + 1.0);
  shadowValue = max(0.0, (aoAndShadow.g - 1.0) * shPassMapIntensity + 1.0);

  #if defined ( USE_APPLY_AO_AND_SHADOW_TO_ALPHA )
    diffuseColor.a = 1.0 - (1.0 - diffuseColor.a) * aoPassMapValue * shadowValue;
  #else
    ambientOcclusion = min( ambientOcclusion, aoPassMapValue );
  #endif

	reflectedLight.indirectDiffuse *= ambientOcclusion * shadowValue;
  
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion * shadowValue;
	#endif

	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion * shadowValue;
	#endif

	#if defined( USE_ENVMAP ) && defined( STANDARD )

		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );

		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion * shadowValue, material.roughness );
    
	#endif
`;
