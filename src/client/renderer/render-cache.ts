import type { Material, Object3D } from 'three';
import { Mesh } from 'three';
import { MeshStandardMaterial } from 'three';

export interface RenderCache {
  dispose(): void;
  clear(): void;
  addLineOrPoint(object3d: Object3D): void;
  addMesh(mesh: Mesh): void;
  addObject(object3d: Object3D): void;
  onBeforeRender(): void;
  onAfterRender(): void;
}

export interface ThreeObject3d {
  isLine?: boolean;
  isPoints?: boolean;
  isMesh?: boolean;
}

class RenderCacheMapItem {
  public needsUpdate: boolean = true;
  private _cache: RenderCache | null = null;

  constructor(cache: RenderCache) {
    this._cache = cache;
  }

  public dispose() {
    this._cache?.dispose();
  }

  public clear() {
    this._cache?.clear();
    this.needsUpdate = true;
  }

  public update(object3d: Object3D) {
    if (!this.needsUpdate || !this._cache) {
      return;
    }
    object3d.traverse((object: Object3D | ThreeObject3d) => {
      if (
        (object as ThreeObject3d).isLine ||
        (object as ThreeObject3d).isPoints
      ) {
        this._cache?.addLineOrPoint(object as Object3D);
      } else if ((object as ThreeObject3d).isMesh) {
        this._cache?.addMesh(object as Mesh);
      } else {
        this._cache?.addObject(object as Object3D);
      }
    });
    this.needsUpdate = false;
  }

  public onBeforeRender(): void {
    this._cache?.onBeforeRender();
  }

  public onAfterRender(): void {
    this._cache?.onAfterRender();
  }
}

export type CacheKey = any;

export class RenderCacheManager {
  private _cacheMap: Map<CacheKey, RenderCacheMapItem> = new Map();

  public dispose() {
    this._cacheMap.forEach((cache) => {
      cache.dispose();
    });
  }

  public registerCache(key: CacheKey, cache: RenderCache) {
    this._cacheMap.set(key, new RenderCacheMapItem(cache));
  }

  public clearCache() {
    this._cacheMap.forEach((cache) => {
      cache.clear();
    });
  }

  public clearObjectCache(key: CacheKey) {
    const cache = this._cacheMap.get(key);
    if (cache) {
      cache.clear();
    }
  }

  public onBeforeRender(key: CacheKey, object3d: Object3D): void {
    const cache = this._cacheMap.get(key);
    if (cache) {
      cache.update(object3d);
      cache.onBeforeRender();
    }
  }

  public onAfterRender(key: CacheKey): void {
    const cache = this._cacheMap.get(key);
    if (cache) {
      cache.onAfterRender();
    }
  }

  public render(key: CacheKey, object3d: Object3D, renderMethod: () => void) {
    const cache = this._cacheMap.get(key);
    if (cache) {
      cache.update(object3d);
      cache.onBeforeRender();
    }
    renderMethod();
    if (cache) {
      cache.onAfterRender();
    }
  }
}

export class VisibilityRenderCache implements RenderCache {
  private _visibilityCache: Map<Object3D, boolean> = new Map();
  private _isObjectInvisible?: (object: any) => boolean;

  constructor(isObjectInvisible?: (object: any) => boolean) {
    this._isObjectInvisible = isObjectInvisible;
  }

  public dispose(): void {
    this._visibilityCache.clear();
  }

  public clear(): void {
    this._visibilityCache.clear();
  }

  public addLineOrPoint(object3d: Object3D): void {
    this._visibilityCache.set(object3d, object3d.visible);
  }

  public addMesh(mesh: Mesh): void {
    if (this._isObjectInvisible && this._isObjectInvisible(mesh)) {
      this._visibilityCache.set(mesh, mesh.visible);
    }
  }

  public addObject(object3d: Object3D): void {
    if (this._isObjectInvisible && this._isObjectInvisible(object3d)) {
      this._visibilityCache.set(object3d, object3d.visible);
    }
  }

  public onBeforeRender(): void {
    this._visibilityCache.forEach((_visible: boolean, object: Object3D) => {
      object.visible = false;
    });
  }

  public onAfterRender(): void {
    this._visibilityCache.forEach((visible: boolean, object: Object3D) => {
      object.visible = visible;
    });
  }
}

export class DepthWriteRenderCache {
  private _depthWriteCache = new Set<MeshStandardMaterial>();
  private _doNotWriteDepth?: (mesh: Mesh) => boolean;

  constructor(doNotWriteDepth?: (object: any) => boolean) {
    this._doNotWriteDepth = doNotWriteDepth;
  }

  public dispose(): void {
    this._depthWriteCache.clear();
  }

  public clear(): void {
    this._depthWriteCache.clear();
  }

  public addLineOrPoint(_: Object3D): void {
    // do nothing
  }
  public addObject(_: Object3D): void {
    // do nothing
  }

  public addMesh(mesh: Mesh): void {
    if (
      this._doNotWriteDepth &&
      this._doNotWriteDepth(mesh) &&
      mesh.material instanceof MeshStandardMaterial &&
      mesh.material.depthWrite
    ) {
      this._depthWriteCache.add(mesh.material);
    }
  }

  public onBeforeRender(): void {
    this._depthWriteCache.forEach((material: MeshStandardMaterial) => {
      material.depthWrite = false;
    });
  }

  public onAfterRender(): void {
    this._depthWriteCache.forEach((material: MeshStandardMaterial) => {
      material.depthWrite = true;
    });
  }
}

export interface ObjectCacheData {
  visible?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  material?: Material | Material[];
}

interface ObjectCacheEntry {
  originalObjectData: ObjectCacheData;
  updateObjectData: ObjectCacheData;
}

export abstract class ObjectRenderCache implements RenderCache {
  private _objectCache = new Map<Object3D, ObjectCacheEntry>();

  public abstract dispose(): void;
  public abstract addLineOrPoint(object3d: Object3D): void;
  public abstract addMesh(mesh: Mesh): void;
  public abstract addObject(object3d: Object3D): void;

  public clear(): void {
    this._objectCache.clear();
  }

  public onBeforeRender(): void {
    this._objectCache.forEach((data: ObjectCacheEntry, object: Object3D) => {
      if (object instanceof Mesh) {
        // update the cache if properties of the object have changed
        if (
          object.material !== data.originalObjectData.material &&
          object.material !== data.updateObjectData.material
        ) {
          data.originalObjectData.material = object.material;
        }
        if (object.receiveShadow !== data.originalObjectData.receiveShadow) {
          data.originalObjectData.receiveShadow = object.receiveShadow;
        }
        if (object.castShadow !== data.originalObjectData.castShadow) {
          data.originalObjectData.castShadow = object.castShadow;
        }
        if (object.visible !== data.originalObjectData.visible) {
          data.originalObjectData.visible = object.visible;
        }
      }
      this._updateObject(object, data.updateObjectData);
    });
  }

  public onAfterRender(): void {
    this._objectCache.forEach((data: ObjectCacheEntry, object: Object3D) => {
      this._updateObject(object, data.originalObjectData);
    });
  }

  public addToCache(
    object: Object3D | Mesh,
    updateObjectData: ObjectCacheData
  ): void {
    this._objectCache.set(object, {
      originalObjectData: {
        visible: object.visible,
        castShadow: object.castShadow,
        receiveShadow:
          object instanceof Mesh ? object.receiveShadow : undefined,
        material: object instanceof Mesh ? object.material : undefined,
      },
      updateObjectData,
    });
  }

  private _updateObject(object: Object3D, objectData: ObjectCacheData) {
    if (objectData.visible !== undefined) {
      object.visible = objectData.visible;
    }
    if (objectData.castShadow !== undefined) {
      object.castShadow = objectData.castShadow;
    }
    if (object instanceof Mesh && objectData.receiveShadow !== undefined) {
      (object as Mesh).receiveShadow = objectData.receiveShadow;
    }
    if (object instanceof Mesh && objectData.material !== undefined) {
      (object as Mesh).material = objectData.material as Material;
    }
  }
}
