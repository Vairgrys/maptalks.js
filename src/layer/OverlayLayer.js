import { GEOJSON_TYPES } from '../core/Constants';
import { isNil, UID, isObject, extend, isFunction, parseStyleRootPath } from '../core/util';
import Extent from '../geo/Extent';
import { Geometry } from '../geometry';
import { createFilter, getFilterFeature, compileStyle } from '@maptalks/feature-filter';
import Layer from './Layer';
import GeoJSON from '../geometry/GeoJSON';

/**
 * @property {Boolean}  [options.drawImmediate=false] - (Only for layer rendered with [CanvasRenderer]{@link renderer.CanvasRenderer}) <br>
 *                                                    In default, for performance reason, layer will be drawn in a frame requested by RAF(RequestAnimationFrame).<br>
 *                                                    Set drawImmediate to true to draw immediately.<br>
 *                                                    This is necessary when layer's drawing is wrapped with another frame requested by RAF.
 * @memberOf OverlayLayer
 * @instance
 */
const options = {
    'drawImmediate': false,
    'geometryEvents': true
};


const TMP_EVENTS_ARR = [];

/**
 * @classdesc
 * Base class of all the layers that can add/remove geometries. <br>
 * It is abstract and not intended to be instantiated.
 * @category layer
 * @abstract
 * @extends Layer
 */
class OverlayLayer extends Layer {

    constructor(id, geometries, options) {
        if (geometries && (!(geometries instanceof Geometry) && !Array.isArray(geometries) && GEOJSON_TYPES.indexOf(geometries.type) < 0)) {
            options = geometries;
            geometries = null;
        }
        super(id, options);
        this._maxZIndex = 0;
        this._minZIndex = 0;
        this._initCache();
        if (geometries) {
            this.addGeometry(geometries);
        }
        const style = this.options['style'];
        if (style) {
            this.setStyle(style);
        }
    }

    /**
     * Get a geometry by its id
     * @param  {String|Number} id   - id of the geometry
     * @return {Geometry}
     */
    getGeometryById(id) {
        if (isNil(id) || id === '') {
            return null;
        }
        if (!this._geoMap[id]) {
            return null;
        }
        return this._geoMap[id];
    }

    /**
     * Get all the geometries or the ones filtered if a filter function is provided.
     * @param {Function} [filter=undefined]  - a function to filter the geometries
     * @param {Object} [context=undefined]   - context of the filter function, value to use as this when executing filter.
     * @return {Geometry[]}
     */
    getGeometries(filter, context) {
        if (!filter) {
            return this._geoList.slice(0);
        }
        const result = [];
        let geometry, filtered;
        for (let i = 0, l = this._geoList.length; i < l; i++) {
            geometry = this._geoList[i];
            if (context) {
                filtered = filter.call(context, geometry);
            } else {
                filtered = filter(geometry);
            }
            if (filtered) {
                result.push(geometry);
            }
        }
        return result;
    }

    /**
     * Get the first geometry, the geometry at the bottom.
     * @return {Geometry} first geometry
     */
    getFirstGeometry() {
        if (!this._geoList.length) {
            return null;
        }
        return this._geoList[0];
    }

    /**
     * Get the last geometry, the geometry on the top
     * @return {Geometry} last geometry
     */
    getLastGeometry() {
        const len = this._geoList.length;
        if (len === 0) {
            return null;
        }
        return this._geoList[len - 1];
    }

    /**
     * Get count of the geometries
     * @return {Number} count
     */
    getCount() {
        return this._geoList.length;
    }

    /**
     * Get extent of all the geometries in the layer, return null if the layer is empty.
     * @return {Extent} - extent of the layer
     */
    getExtent() {
        if (this.getCount() === 0) {
            return null;
        }
        const extent = new Extent(this.getProjection());
        this.forEach(g => {
            extent._combine(g.getExtent());
        });
        return extent;
    }

    /**
     * Executes the provided callback once for each geometry present in the layer in order.
     * @param  {Function} fn - a callback function
     * @param  {*} [context=undefined]   - callback's context, value to use as this when executing callback.
     * @return {OverlayLayer} this
     */
    forEach(fn, context) {
        const copyOnWrite = this._geoList.slice(0);
        for (let i = 0, l = copyOnWrite.length; i < l; i++) {
            if (!context) {
                fn(copyOnWrite[i], i);
            } else {
                fn.call(context, copyOnWrite[i], i);
            }
        }
        return this;
    }

    /**
     * Creates a GeometryCollection with all the geometries that pass the test implemented by the provided function.
     * @param  {Function} fn      - Function to test each geometry
     * @param  {*} [context=undefined]  - Function's context, value to use as this when executing function.
     * @return {GeometryCollection} A GeometryCollection with all the geometries that pass the test
     */
    filter(fn, context) {
        const selected = [];
        const isFn = isFunction(fn);
        const filter = isFn ? fn : createFilter(fn);

        this.forEach(geometry => {
            const g = isFn ? geometry : getFilterFeature(geometry);
            if (context ? filter.call(context, g) : filter(g)) {
                selected.push(geometry);
            }
        }, this);
        return selected;
    }

    /**
     * Whether the layer is empty.
     * @return {Boolean}
     */
    isEmpty() {
        return !this._geoList.length;
    }

    /**
     * Adds one or more geometries to the layer
     * @param {Geometry|Geometry[]} geometries - one or more geometries
     * @param {Boolean|Object} [fitView=false]  - automatically set the map to a fit center and zoom for the geometries
     * @param {String} [fitView.easing=out]  - default animation type
     * @param {Number} [fitView.duration=map.options.zoomAnimationDuration]  - default animation time
     * @param {Function} [fitView.step=null]  - step function during animation, animation frame as the parameter
     * @return {OverlayLayer} this
     */
    addGeometry(geometries, fitView) {
        if (!geometries) {
            return this;
        }
        if (geometries.type === 'FeatureCollection') {
            return this.addGeometry(GeoJSON.toGeometry(geometries), fitView);
        } else if (!Array.isArray(geometries)) {
            const count = arguments.length;
            const last = arguments[count - 1];
            geometries = Array.prototype.slice.call(arguments, 0, count - 1);
            fitView = last;
            if (last && isObject(last) && (('type' in last) || last instanceof Geometry)) {
                geometries.push(last);
                fitView = false;
            }
            return this.addGeometry(geometries, fitView);
        } else if (geometries.length === 0) {
            return this;
        }
        this._initCache();
        let extent;
        if (fitView) {
            extent = new Extent();
        }
        this._toSort = this._maxZIndex > 0;
        const geos = [];
        for (let i = 0, l = geometries.length; i < l; i++) {
            let geo = geometries[i];
            if (!geo) {
                throw new Error('Invalid geometry to add to layer(' + this.getId() + ') at index:' + i);
            }
            if (!(geo instanceof Geometry)) {
                geo = Geometry.fromJSON(geo);
                if (Array.isArray(geo)) {
                    for (let ii = 0, ll = geo.length; ii < ll; ii++) {
                        this._add(geo[ii], extent, i);
                        geos.push(geo[ii]);
                    }
                }
            }
            if (!Array.isArray(geo)) {
                this._add(geo, extent, i);
                geos.push(geo);
            }
        }
        const map = this.getMap();
        if (map) {
            this._getRenderer().onGeometryAdd(geos);
            if (extent && !isNil(extent.xmin)) {
                const center = extent.getCenter();
                const z = map.getFitZoom(extent);

                if (isObject(fitView)) {
                    const step = isFunction(fitView.step) ? fitView.step : () => undefined;
                    map.animateTo({
                        center,
                        zoom: z,
                    }, extend({
                        duration: map.options.zoomAnimationDuration,
                        easing: 'out',
                    }, fitView), step);
                } else if (fitView === true) {
                    map.setCenterAndZoom(center, z);
                }
            }
        }
        /**
         * addgeo event.
         *
         * @event OverlayLayer#addgeo
         * @type {Object}
         * @property {String} type - addgeo
         * @property {OverlayLayer} target - layer
         * @property {Geometry[]} geometries - the geometries to add
         */
        this.fire('addgeo', {
            'geometries': geometries
        });
        return this;
    }

    /**
     * Get minimum zindex of geometries
     */
    getGeoMinZIndex() {
        return this._minZIndex;
    }

    /**
     * Get maximum zindex of geometries
     */
    getGeoMaxZIndex() {
        return this._maxZIndex;
    }


    _add(geo, extent, i) {
        if (!this._toSort) {
            this._toSort = geo.getZIndex() !== 0;
        }
        this._updateZIndex(geo.getZIndex());
        const geoId = geo.getId();
        if (!isNil(geoId)) {
            if (!isNil(this._geoMap[geoId])) {
                throw new Error('Duplicate geometry id in layer(' + this.getId() + '):' + geoId + ', at index:' + i);
            }
            this._geoMap[geoId] = geo;
        }
        const internalId = UID();
        geo._setInternalId(internalId);
        this._geoList.push(geo);
        this.onAddGeometry(geo);
        geo._bindLayer(this);
        if (geo.onAdd) {
            geo.onAdd();
        }
        if (extent) {
            extent._combine(geo.getExtent());
        }
        /**
         * add event.
         *
         * @event Geometry#add
         * @type {Object}
         * @property {String} type - add
         * @property {Geometry} target - geometry
         * @property {Layer} layer - the layer added to.
         */
        geo._fireEvent('add', {
            'layer': this
        });
        if (this._cookedStyles) {
            this._styleGeometry(geo);
        }
    }

    /**
     * Removes one or more geometries from the layer
     * @param  {String|String[]|Geometry|Geometry[]} geometries - geometry ids or geometries to remove
     * @returns {OverlayLayer} this
     */
    removeGeometry(geometries) {
        if (!Array.isArray(geometries)) {
            return this.removeGeometry([geometries]);
        }
        for (let i = geometries.length - 1; i >= 0; i--) {
            if (!(geometries[i] instanceof Geometry)) {
                geometries[i] = this.getGeometryById(geometries[i]);
            }
            if (!geometries[i] || this !== geometries[i].getLayer()) continue;
            geometries[i].remove();
        }
        /**
         * removegeo event.
         *
         * @event OverlayLayer#removegeo
         * @type {Object}
         * @property {String} type - removegeo
         * @property {OverlayLayer} target - layer
         * @property {Geometry[]} geometries - the geometries to remove
         */
        this.fire('removegeo', {
            'geometries': geometries
        });
        return this;
    }

    /**
     * Clear all geometries in this layer
     * @returns {OverlayLayer} this
     */
    clear() {
        this._clearing = true;
        this.forEach(geo => {
            geo.remove();
        });
        this._geoMap = {};
        const old = this._geoList;
        this._geoList = [];
        const renderer = this._getRenderer();
        if (renderer) {
            renderer.onGeometryRemove(old);
            if (renderer.clearImageData) {
                renderer.clearImageData();
                delete renderer._lastGeosToDraw;
            }
        }
        this._clearing = false;
        /**
         * clear event.
         *
         * @event OverlayLayer#clear
         * @type {Object}
         * @property {String} type - clear
         * @property {OverlayLayer} target - layer
         */
        this.fire('clear');
        return this;
    }

    /**
     * Called when geometry is being removed to clear the context concerned.
     * @param  {Geometry} geometry - the geometry instance to remove
     * @protected
     */
    onRemoveGeometry(geometry) {
        if (!geometry || this._clearing) { return; }
        //考察geometry是否属于该图层
        if (this !== geometry.getLayer()) {
            return;
        }
        const internalId = geometry._getInternalId();
        if (isNil(internalId)) {
            return;
        }
        const geoId = geometry.getId();
        if (!isNil(geoId)) {
            delete this._geoMap[geoId];
        }
        const idx = this._findInList(geometry);
        if (idx >= 0) {
            this._geoList.splice(idx, 1);
        }
        if (this._getRenderer()) {
            this._getRenderer().onGeometryRemove([geometry]);
        }
    }

    /**
     * Gets layer's style.
     * @return {Object|Object[]} layer's style
     */
    getStyle() {
        if (!this.options['style']) {
            return null;
        }
        return this.options['style'];
    }

    /**
     * Sets style to the layer, styling the geometries satisfying the condition with style's symbol. <br>
     * Based on filter type in [mapbox-gl-js's style specification]{https://www.mapbox.com/mapbox-gl-js/style-spec/#types-filter}.
     * @param {Object|Object[]} style - layer's style
     * @returns {VectorLayer} this
     * @fires VectorLayer#setstyle
     * @example
     * layer.setStyle([
        {
          'filter': ['==', 'count', 100],
          'symbol': {'markerFile' : 'foo1.png'}
        },
        {
          'filter': ['==', 'count', 200],
          'symbol': {'markerFile' : 'foo2.png'}
        }
      ]);
     */
    setStyle(style) {
        this.options.style = style;
        style = parseStyleRootPath(style);
        this._cookedStyles = compileStyle(style);
        this.forEach(function (geometry) {
            this._styleGeometry(geometry);
        }, this);
        /**
         * setstyle event.
         *
         * @event VectorLayer#setstyle
         * @type {Object}
         * @property {String} type - setstyle
         * @property {VectorLayer} target - layer
         * @property {Object|Object[]}       style - style to set
         */
        this.fire('setstyle', {
            'style': style
        });
        return this;
    }

    _styleGeometry(geometry) {
        if (!this._cookedStyles) {
            return false;
        }
        const g = getFilterFeature(geometry);
        for (let i = 0, len = this._cookedStyles.length; i < len; i++) {
            if (this._cookedStyles[i]['filter'](g) === true) {
                geometry._setExternSymbol(this._cookedStyles[i]['symbol']);
                return true;
            }
        }
        return false;
    }

    /**
     * Removes layers' style
     * @returns {VectorLayer} this
     * @fires VectorLayer#removestyle
     */
    removeStyle() {
        if (!this.options.style) {
            return this;
        }
        delete this.options.style;
        delete this._cookedStyles;
        this.forEach(function (geometry) {
            geometry._setExternSymbol(null);
        }, this);
        /**
         * removestyle event.
         *
         * @event VectorLayer#removestyle
         * @type {Object}
         * @property {String} type - removestyle
         * @property {VectorLayer} target - layer
         */
        this.fire('removestyle');
        return this;
    }

    onAddGeometry(geo) {
        const style = this.getStyle();
        if (style) {
            this._styleGeometry(geo);
        }
    }

    hide() {
        for (let i = 0, l = this._geoList.length; i < l; i++) {
            this._geoList[i].onHide();
        }
        return Layer.prototype.hide.call(this);
    }

    _initCache() {
        if (!this._geoList) {
            this._geoList = [];
            this._geoMap = {};
        }
    }

    _updateZIndex(...zIndex) {
        this._maxZIndex = Math.max(this._maxZIndex, Math.max.apply(Math, zIndex));
        this._minZIndex = Math.min(this._minZIndex, Math.min.apply(Math, zIndex));
    }

    _sortGeometries() {
        if (!this._toSort) {
            return;
        }
        this._maxZIndex = 0;
        this._minZIndex = 0;
        this._geoList.sort((a, b) => {
            this._updateZIndex(a.getZIndex(), b.getZIndex());
            return this._compare(a, b);
        });
        this._toSort = false;
    }

    _compare(a, b) {
        if (a.getZIndex() === b.getZIndex()) {
            return a._getInternalId() - b._getInternalId();
        }
        return a.getZIndex() - b.getZIndex();
    }

    //binarySearch
    _findInList(geo) {
        const len = this._geoList.length;
        if (len === 0) {
            return -1;
        }
        this._sortGeometries();
        let low = 0,
            high = len - 1,
            middle;
        while (low <= high) {
            middle = Math.floor((low + high) / 2);
            if (this._geoList[middle] === geo) {
                return middle;
            } else if (this._compare(this._geoList[middle], geo) > 0) {
                high = middle - 1;
            } else {
                low = middle + 1;
            }
        }
        return -1;
    }

    _onGeometryEvent(param) {
        if (!param || !param['target']) {
            return;
        }
        const type = param['type'];
        if (type === 'idchange') {
            this._onGeometryIdChange(param);
        } else if (type === 'zindexchange') {
            this._onGeometryZIndexChange(param);
        } else if (type === 'positionchange') {
            this._onGeometryPositionChange(param);
        } else if (type === 'shapechange') {
            this._onGeometryShapeChange(param);
        } else if (type === 'symbolchange') {
            this._onGeometrySymbolChange(param);
        } else if (type === 'show') {
            this._onGeometryShow(param);
        } else if (type === 'hide') {
            this._onGeometryHide(param);
        } else if (type === 'propertieschange') {
            this._onGeometryPropertiesChange(param);
        }
    }

    _onGeometryIdChange(param) {
        if (param['new'] === param['old']) {
            if (this._geoMap[param['old']] && this._geoMap[param['old']] === param['target']) {
                return;
            }
        }
        if (!isNil(param['new'])) {
            if (this._geoMap[param['new']]) {
                throw new Error('Duplicate geometry id in layer(' + this.getId() + '):' + param['new']);
            }
            this._geoMap[param['new']] = param['target'];
        }
        if (!isNil(param['old']) && param['new'] !== param['old']) {
            delete this._geoMap[param['old']];
        }

    }

    _onGeometryZIndexChange(param) {
        if (param['old'] !== param['new']) {
            this._updateZIndex(param['new']);
            this._toSort = true;
            if (this._getRenderer()) {
                this._getRenderer().onGeometryZIndexChange(param);
            }
        }
    }

    _onGeometryPositionChange(param) {
        if (this._getRenderer()) {
            this._getRenderer().onGeometryPositionChange(param);
        }
    }

    _onGeometryShapeChange(param) {
        if (this._getRenderer()) {
            this._getRenderer().onGeometryShapeChange(param);
        }
    }

    _onGeometrySymbolChange(param) {
        if (this._getRenderer()) {
            this._getRenderer().onGeometrySymbolChange(param);
        }
    }

    _onGeometryShow(param) {
        if (this._getRenderer()) {
            this._getRenderer().onGeometryShow(param);
        }
    }

    _onGeometryHide(param) {
        if (this._getRenderer()) {
            this._getRenderer().onGeometryHide(param);
        }
    }

    _onGeometryPropertiesChange(param) {
        if (this._getRenderer()) {
            this._getRenderer().onGeometryPropertiesChange(param);
        }
    }

    _hasGeoListeners(eventTypes) {
        if (!eventTypes) {
            return false;
        }
        if (!Array.isArray(eventTypes)) {
            TMP_EVENTS_ARR[0] = eventTypes;
            eventTypes = TMP_EVENTS_ARR;
        }
        const geos = this.getGeometries() || [];
        for (let i = 0, len = geos.length; i < len; i++) {
            for (let j = 0, len1 = eventTypes.length; j < len1; j++) {
                const eventType = eventTypes[j];
                const listens = geos[i].listens(eventType);
                if (listens > 0) {
                    return true;
                }
            }
        }
        return false;
    }
}

OverlayLayer.mergeOptions(options);

export default OverlayLayer;
