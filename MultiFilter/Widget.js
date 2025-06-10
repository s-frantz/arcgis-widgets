///////////////////////////////////////////////////////////////////////////
// MultiFilter Widget
// Copyright © Silas Frantz. All Rights Reserved.
//
// Forked from Esri's Filter widget (original authors: Esri R&D Center Beijing).
//
// Licensed under the Apache License Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Description:
//   MultiFilter supports complete and partial multi-layer filtering
//   from single-layer filter configs. Forked from Esri Filter widget, 2025.
///////////////////////////////////////////////////////////////////////////


define([
    'dojo/_base/declare',
    'dojo/_base/array',
    'dojo/_base/html',
    'dojo/_base/lang',
    'dojo/topic',
    "esri/geometry/Extent",
    'esri/SpatialReference',
    'dojo',
    'dojo/query',
    'dojo/on',
    'dojo/keys',
    'dijit/focus',
    'dijit/_WidgetsInTemplateMixin',
    'jimu/utils',
    'jimu/BaseWidget',
    'jimu/filterUtils',
    'jimu/dijit/FilterParameters',
    'jimu/LayerInfos/LayerInfos',
    'jimu/FilterManager',
    // 'esri/tasks/query',
    // 'esri/tasks/QueryTask',
    'esri/symbols/jsonUtils',
    'jimu/symbolUtils',
    'jimu/dijit/LayerChooserFromMapWithDropbox',
    'jimu/dijit/Filter',
    './CustomFeaturelayerChooserFromMap',
    'jimu/dijit/ToggleButton',
    'dojo/NodeList',
    'dojo/NodeList-dom'
  ],
  function(declare, array, html, lang, topic, Extent, SpatialReference,
    dojo, query, on, keys, focusUtil, _WidgetsInTemplateMixin,
    jimuUtils, BaseWidget, FilterUtils, FilterParameters, LayerInfos, FilterManager,
    // Query, QueryTask,
    esriSymbolJsonUtils, jimuSymUtils, LayerChooserFromMapWithDropbox, Filter,
    CustomFeaturelayerChooserFromMap, ToggleButton) {

    function ensureArcGISAuth(serviceUrl, callback) {
      require(['esri/IdentityManager'], function(esriId) {
        esriId.checkSignInStatus(serviceUrl)
          .then(function() {
            console.log('[Filter][Auth] User is authenticated for', serviceUrl);
            if (callback) callback();
          })
          .catch(function() {
            // This will trigger the login dialog if not authenticated
            console.log('[Filter][Auth] Prompting login for', serviceUrl);
            esriId.signIn(serviceUrl).then(function() {
              if (callback) callback();
            });
          });
      });
    }

    return declare([BaseWidget, _WidgetsInTemplateMixin], {
      name: 'MultiFilter',
      baseClass: 'jimu-widget-filter',
      //style="display:${hasValue}"

      _itemTemplate: '<li class="filter-item" data-index="${index}">' +
        '<div class="header" >' +
          '<span class="arrow jimu-float-leading jimu-trailing-margin05" title="${toggleTip}" ></span>' +
          '<span class="icon">' +
            '<img src="${icon}" />' +
          '</span>' +
          '<span class="icon symbolIcon" style="display:none;">' +
          '</span>' +
          '<span class="item-title">${title}</span>' +
          '<span class="toggle-filter jimu-trailing-margin1"></span>' +
        '</div>' +
        '<div class="body">' +
          '<div class="parameters"></div>' +
        '</div>' +
      '</li>',
      _store: null,
      homeExtent: null, //when zoombackto option is enabled
      _layerTreePromise: null,

      postMixInProperties:function(){
        this.jimuNls = window.jimuNls;
      },

      postCreate: function(){
        this.inherited(arguments);
        this._store = {};
        this.layerInfosObj = LayerInfos.getInstanceSync();
        this.filterUtils = new FilterUtils();
        this.filterManager = FilterManager.getInstance();

        this.initFilterActions();

        var existAskForValue = this.initAllFilters();
        if(!existAskForValue){
          html.addClass(this.domNode, 'not-exist-ask-for-value');
        }

        this.own(topic.subscribe("appConfigChanged", lang.hitch(this, this.onAppConfigChanged)));
      },

      onAppConfigChanged: function(appConfig, reason, changedData) {
        if (reason === "mapOptionsChange" && changedData && appConfig && changedData.extent) {
          this.homeExtent = new Extent(changedData.extent);
        }
      },

      startup: function() {
        this.inherited(arguments);
        this.resize();

        //get homeExtent
        var configExtent = this.appConfig && this.appConfig.map &&
          this.appConfig.map.mapOptions && this.appConfig.map.mapOptions.extent;

        if (configExtent) {
          this.homeExtent = new Extent(
            configExtent.xmin,
            configExtent.ymin,
            configExtent.xmax,
            configExtent.ymax,
            new SpatialReference(configExtent.spatialReference)
          );
        } else {
          this.homeExtent = this.map._initialExtent || this.map.extent;
        }
      },

      initFilterActions: function(){
        this.filterActions = [];
        if(this.config.allowTurnOffAll){
          html.setStyle(this.showTurnOffAllButtonNode, 'display', 'block');
          this.filterActions.push(this.showTurnOffAllButtonNode);
        }
        if(this.config.allowResetAll){
          html.setStyle(this.showResetAllButtonNode, 'display', 'block');
          this.filterActions.push(this.showResetAllButtonNode);
        }
        if(this.config.allowCustom){
          this.filterActions.push(this.showCustomButtonNode);
          html.setStyle(this.showCustomButtonNode, 'display', 'block');
          this.own(on(this.customFilterContainerNode, 'keydown', lang.hitch(this, function(evt){
            if(evt.keyCode === keys.ESCAPE){
              evt.stopPropagation();
              focusUtil.focus(this.customBackNode);
            }
          })));
        }else{
          html.setAttr(this.showTurnOffAllButtonNode, 'title', this.nls.turnOffAllForNoCustom);
          html.setAttr(this.showResetAllButtonNode, 'title', this.nls.resetAllForNoCustom);
        }

        if(this.filterActions.length === 0) {
          return;
        }

        html.addClass(this.domNode, 'has-filter-actions');

        var lastNode;
        if(this.filterActions.length === 1) {
          html.addClass(this.filterActions[0], 'absolute-icon');
          html.setStyle(this.filterActionsPopup, 'display', 'block');
          lastNode = this.filterActions[0];
        }else if(this.filterActions.length > 1){
          html.setStyle(this.showFilterActionsButtonNode, 'display', 'block');
          lastNode = this.showFilterActionsButtonNode;

          this.own(on(this.filterActionsPopup, 'keydown', lang.hitch(this, function(evt){
            if(evt.keyCode === keys.TAB){
              var lastActionNode = this.filterActions[this.filterActions.length - 1];
              if(evt.shiftKey && evt.target === this.filterActions[0]){
                evt.preventDefault();
                lastActionNode.focus();
              }else if(!evt.shiftKey && evt.target === lastActionNode){
                evt.preventDefault();
                this.filterActions[0].focus();
              }
            }else if(evt.keyCode === keys.ESCAPE){
              evt.preventDefault();
              evt.stopPropagation();
              this._onShowFilterActionsClick();
            }
          })));

          this.own(on(document.body, 'click', lang.hitch(this, function(evt){
            if(html.getStyle(this.filterActionsPopup, 'display') === 'block'){
              var isInternal = html.isDescendant(evt.target, this.filterActionsPopup);
              if(evt.target !== this.showFilterActionsButtonNode && !isInternal){
                this._onShowFilterActionsClick();
              }
            }
          })));

        }
        jimuUtils.initLastFocusNode(this.domNode, lastNode);
      },

      //actions button
      _onShowFilterActionsClick: function(evt){
        if(evt){
          evt.preventDefault();
        }
        if(html.hasClass(this.showFilterActionsButtonNode, 'active')){
          html.setAttr(this.showFilterActionsButtonNode, 'title', this.nls.filterActions);
          html.removeClass(this.showFilterActionsButtonNode, 'active');
          html.setStyle(this.filterActionsPopup, 'display', 'none');
          focusUtil.focus(this.showFilterActionsButtonNode);
        }else {
          html.setAttr(this.showFilterActionsButtonNode, 'title', this.jimuNls.common.close);
          html.addClass(this.showFilterActionsButtonNode, 'active');
          html.setStyle(this.filterActionsPopup, 'display', 'block');
          focusUtil.focus(this.filterActions[0]);
        }
      },

      _onShowFilterActionsKeydown: function(evt){
        if(evt.keyCode === keys.ENTER || evt.keyCode === keys.SPACE){
          this._onShowFilterActionsClick(evt);
        }
      },

      initAllFilters: function(){
        var existAskForValue = false;
        var filters = this.config.filters;
        //set filters's order by layer
        if(this.config.groupByLayer){
          var newFilters = {};
          array.forEach(filters, function(filterObj) {
            if(!newFilters[filterObj.layerId]){
              newFilters[filterObj.layerId] = [];
            }
            newFilters[filterObj.layerId].push(filterObj);
          }, this);

          var lastFilterKey = '';
          for(var _key in newFilters){
            lastFilterKey = _key;
          }
          for(var key in newFilters){
            // for(var key = 0; key < newFilters.length; key ++){
            var layer = this.layerInfosObj.getLayerInfoById(key);
            // var layerName = this.layerInfosObj._getLayerTitle(layer); //don't use private function
            var layerNameNode = document.createElement('div');
            html.addClass(layerNameNode, "filter-layer-name");
            layerNameNode.innerText = layer.title;
            html.place(layerNameNode, this.filterList);

            var isCheckLastNode = (key === lastFilterKey) ? true: false;
            existAskForValue = this._initFilters(newFilters[key], existAskForValue, isCheckLastNode);
          }
        }else{
          existAskForValue = this._initFilters(filters, existAskForValue, true);
        }
        return existAskForValue;
      },

      _initFilters: function(filters, existAskForValue, isCheckLastNode){
        // isCheckLastNode = this.config.allowCustom ? false : isCheckLastNode;
        isCheckLastNode = this.filterActions.length > 0 ? false : isCheckLastNode;
        var filterIndex = 0;
        var filtersLength = filters.length;
        array.forEach(filters, function(filterObj, idx) {
          var isAskForValue = this.filterUtils.isAskForValues(filterObj.filter);

          if(isAskForValue){
            existAskForValue = true;
          }

          // filterObj.icon = (filterObj.symbol && filterObj.symbol.url) ? filterObj.symbol.url : filterObj.icon;
          var parse = {
            icon: filterObj.icon ? jimuUtils.processUrlInWidgetConfig(filterObj.icon, this.folderUrl) :
              this.folderUrl + '/css/images/default_task_icon.png',
            index: idx,
            title: filterObj.name,
            toggleTip: this.nls.toggleTip,
            hasValue: isAskForValue ?
              (window.appInfo.isRunInMobile ? 'block !important' : '') : 'none',
            isAskForValue: isAskForValue,
            apply: lang.getObject('jimuNls.common.apply', false, window) || 'Apply'
          };

          if (!this._store[filterObj.layerId]) {
            this._store[filterObj.layerId] = {
              mapFilterControls: {}
              // filter_item_idx
            }; // filter_item_idx, mapFilterControls
          }

          var template = lang.replace(this._itemTemplate, parse, /\$\{([^\}]+)\}/ig);
          var node = html.toDom(template);
          html.place(node, this.filterList);

          //add layerid to node
          node.currentLayerId = filterObj.layerId;

          if(filterObj.symbol){ //svg
            var icons = query('.icon', node);
            html.setStyle(icons[0], 'display', 'none');
            html.setStyle(icons[1], 'display', 'inline-block');

            var jsonSymbol = esriSymbolJsonUtils.fromJson(filterObj.symbol);
            var size = 16;
            var isImgSym = filterObj.symbol.url || filterObj.symbol.imageData;
            if(isImgSym){//from image chooser
              jsonSymbol.setWidth(size);
              jsonSymbol.setHeight(size);
            }else{
              jsonSymbol.setSize(size);//.setOffset(0, 10);//not work
            }

            var symbolNode;
            if(isImgSym){
              symbolNode = jimuSymUtils.createSymbolNode(jsonSymbol);
            }else{
              symbolNode = jimuSymUtils.createSymbolNode(jsonSymbol, {width:size + 1, height: size + 1});
            }
            html.place(symbolNode, icons[1]);
          }

          var toggleFilterNode = query('.toggle-filter', node)[0];
          var toggleOptions = {
            toggleTips: {
              toggleOn: filterObj.name + ' ' + this.nls.toggleOn,
              toggleOff: filterObj.name + ' ' + this.nls.toggleOff
            }
          };
          var toggleButton = new ToggleButton(toggleOptions, toggleFilterNode);
          toggleButton.startup();
          node.toggleButton = toggleButton;

          var headers = query('.header', node);
          this.own(headers.on('click', lang.hitch(this, 'toggleFilter', node, filterObj, parse)));
          this.own(headers.on('keydown', lang.hitch(this, function(evt){
            var target = evt.target || evt.srcElement;
            if(!html.hasClass(target, 'arrow') && !html.hasClass(target, 'error') &&
              (evt.keyCode === keys.ENTER || evt.keyCode === keys.SPACE)){//toggleBtn supports enter&space
              evt.preventDefault();
              this.toggleFilter(node, filterObj, parse);
            }
          })));

          var firstNode = null;
          var arrows = query('.arrow', node);
          if(isAskForValue){
            html.addClass(node, 'has-ask-for-value');
            html.setAttr(arrows[0], 'tabindex', 0);
            if(idx === 0){
              jimuUtils.initFirstFocusNode(this.domNode, arrows[0]);
              firstNode = arrows[0];
            }
          }else{
            html.addClass(node, 'not-has-ask-for-value');
            if(idx === 0){
              jimuUtils.initFirstFocusNode(this.domNode, toggleFilterNode);
              firstNode = toggleFilterNode;
            }
          }

          //add shift+tab event to firstNode for solving the issue when last filter group is hidden.#15154
          if(firstNode){
            this.own(on(firstNode, 'keydown', lang.hitch(this, function(evt){
              if(this.isLastFilterHidden && evt.shiftKey && evt.keyCode === keys.TAB){
                focusUtil.focus(this.lastToggleBtn);
              }
            })));
          }

          if(isCheckLastNode && filterIndex === filtersLength - 1){
            html.setAttr(node, 'data-isLastNode', 'yes');
          }
          if (parse.hasValue !== 'none') {
            // add parameters
            this.own(arrows.on('click', lang.hitch(this, 'configFilter', node, filterObj)));
            this.own(arrows.on('keydown', lang.hitch(this, function(evt){
              if(evt.keyCode === keys.ENTER){
                this.configFilter(node, filterObj);
              }
            })));

            html.addClass(node, 'requesting');
            this.configFilter(node, filterObj, null, lang.hitch(this, function(buildDef, isError){
              if(isError){
                this._setFilterNodeError(node, filterObj.layerId);
                return;
              }
              if(filterObj.collapse){
                html.removeClass(node, 'config-parameters');
              }

              if(filterObj.autoApplyWhenWidgetOpen){
                this.toggleFilter(node, filterObj, parse);
              }

              if(html.getAttr(node, 'data-isLastNode') === 'yes'){
                buildDef.then(lang.hitch(this, function(valueproviders) {
                  var lastNode = valueproviders[valueproviders.length - 1].domNode;
                  jimuUtils.initLastFocusNode(this.domNode, lastNode);
                }));

                //when last filter modal is hidden.
                this.isLastFilterHidden = false;//it's open at first by design
                var lastArrow = query('.arrow', node)[0];
                if(lastArrow){
                  this.own(on(lastArrow, 'keydown', lang.hitch(this, function(evt){
                    if(evt.keyCode === keys.ENTER){
                      this.isLastFilterHidden = !this.isLastFilterHidden;
                    }
                  })));
                }

                this.lastToggleBtn = query('.toggle-filter', node)[0];
                this.own(on(this.lastToggleBtn, 'keydown', lang.hitch(this, function(evt){
                  if(this.isLastFilterHidden && !evt.shiftKey && evt.keyCode === keys.TAB){
                    evt.preventDefault();
                    jimuUtils.focusFirstFocusNode(this.domNode);
                  }
                })));
              }
            }));
          }else{
            if(filterObj.autoApplyWhenWidgetOpen){
              this.toggleFilter(node, filterObj, parse);
            }
            if(html.getAttr(node, 'data-isLastNode') === 'yes'){
              jimuUtils.initLastFocusNode(this.domNode, toggleFilterNode);
            }
          }

          filterIndex ++;
        }, this);
        return existAskForValue;
      },

      _setFilterNodeError: function(node, layerId){
        //remove arrow-icon, disable toggle-btn, add warnning-icon
        var errorTitle = this.jimuNls.map.layerLoadedError.replace('${layers}', layerId);
        html.setAttr(node, 'aria-disabled', 'true');
        html.removeClass(node, 'config-parameters');
        html.removeClass(node, 'has-ask-for-value');
        html.addClass(node, 'not-has-ask-for-value');

        //change arrow to error
        var arrow = query('.arrow', node)[0];
        html.removeClass(arrow, 'arrow');
        html.addClass(arrow, 'error');
        html.setAttr(arrow, 'title', errorTitle);
        html.setStyle(arrow, 'display', 'block');
      },

      _getPriorityOfMapFilter: function(layerId) {
        var mapFilterControls = lang.getObject(layerId + '.mapFilterControls', false, this._store);
        var count = 0;
        for (var p in mapFilterControls) {
          var control = mapFilterControls[p];
          if (control.priority > count) {
            count = control.priority;
          }
        }

        return count;
      },

      _getMapFilterControl: function(layerId) {
        var mapFilterControls = lang.getObject(layerId + '.mapFilterControls', false, this._store);
        var count = 0;
        var enable = true;
        for (var p in mapFilterControls) {
          var control = mapFilterControls[p];
          if (control.priority > count) {
            enable = !!control.enable;
          }
        }

        return enable;
      },

      // 1. Gather the hierarchical layer structure
      _getLayerTree: function() {
        if (this._layerTreePromise) {
          return this._layerTreePromise;
        }

        // Helper to extract {field_name: field_type} from info, or fetch from REST if missing
        function getFieldTypesDictAsync(info) {
          return new Promise(function(resolve) {
            var fieldsArr = null;
            if (Array.isArray(info.fields)) {
              fieldsArr = info.fields;
            } else if (info.layerObject && Array.isArray(info.layerObject.fields)) {
              fieldsArr = info.layerObject.fields;
            } else if (info.definition && Array.isArray(info.definition.fields)) {
              fieldsArr = info.definition.fields;
            }
            if (fieldsArr) {
              var dict = {};
              fieldsArr.forEach(function(f) {
                if (f && f.name && f.type) {
                  dict[f.name] = f.type;
                }
              });
              resolve(dict);
            } else {
              var url = info.url || (info.layerObject && info.layerObject.url);
              if (url) {
                var restUrl = url + (url.indexOf('?') === -1 ? '?f=json' : '&f=json');
                var serviceRoot = url.replace(/\/\d+$/, ''); // Remove /0, /1, etc.
                ensureArcGISAuth(serviceRoot, function() {
                  require(['esri/request'], function(esriRequest) {
                    esriRequest({
                      url: restUrl,
                      handleAs: 'json',
                      withCredentials: true
                    }).then(function(json) {
                      var dict = {};
                      if (json.fields && json.fields.length) {
                        json.fields.forEach(function(f) {
                          if (f && f.name && f.type) {
                            dict[f.name] = f.type;
                          }
                        });
                      } else {
                        // Only warn if this is a feature layer
                        var isFeatureLayer = false;
                        if (typeof info.isFeatureLayer === 'function') {
                          isFeatureLayer = info.isFeatureLayer();
                        } else if (info.isFeatureLayer) {
                          isFeatureLayer = true;
                        } else if (json.type === 'Feature Layer' || json.type === 'FeatureLayer' || json.geometryType) {
                          isFeatureLayer = true;
                        }
                        if (isFeatureLayer) {
                          console.warn('[Filter][getFieldTypesDictAsync] No fields found in JSON for', restUrl, json);
                        }
                      }
                      resolve(dict);
                    }, function(err) {
                      console.error('[Filter][getFieldTypesDictAsync] esriRequest error for', restUrl, err);
                      resolve({});
                    });
                  });
                });
              } else {
                // Only warn if this is a feature layer
                var isFeatureLayer = false;
                if (typeof info.isFeatureLayer === 'function') {
                  isFeatureLayer = info.isFeatureLayer();
                } else if (info.isFeatureLayer) {
                  isFeatureLayer = true;
                }
                if (isFeatureLayer) {
                  console.warn('[Filter][getFieldTypesDictAsync] No fields and no URL for info:', info);
                }
                resolve({});
              }
            }
          });
        }

        var layerInfos = this.layerInfosObj && this.layerInfosObj.getLayerInfoArray ? this.layerInfosObj.getLayerInfoArray() : [];

        // Recursively build the tree, asynchronously
        function gatherAsync(info, parentTitle) {
          var isFeatureLayer = false, isGroupLayer = false;
          var type = info.layerType || (info.layerObject && info.layerObject.declaredClass) || 'Unknown';

          if (
            type === 'GroupLayer' ||
            (info.getSubLayers && typeof info.getSubLayers === 'function' && info.getSubLayers().length > 0)
          ) {
            isGroupLayer = true;
          }

          if (typeof info.isFeatureLayer === 'function') {
            isFeatureLayer = info.isFeatureLayer();
          } else if (info.layerObject && info.layerObject.declaredClass && info.layerObject.declaredClass.indexOf('FeatureLayer') > -1) {
            isFeatureLayer = true;
          } else if (info.layerType && info.layerType === 'FeatureLayer') {
            isFeatureLayer = true;
          } else if (info.geometryType) {
            isFeatureLayer = true;
            type = 'esri.layers.FeatureLayer';
          } else if (info.definition && info.definition.geometryType) {
            isFeatureLayer = true;
            type = 'esri.layers.FeatureLayer';
          } else if ((info.fields && info.fields.length) || (info.definition && info.definition.fields && info.definition.fields.length)) {
            isFeatureLayer = true;
            type = 'esri.layers.FeatureLayer';
          } else if (info.drawingInfo || (info.definition && info.definition.drawingInfo)) {
            isFeatureLayer = true;
            type = 'esri.layers.FeatureLayer';
          } else if (
            (typeof info.id === 'number' || !isNaN(Number(info.id))) &&
            (info.name || info.title) &&
            (info.type === 'Feature Layer' || (info.capabilities && info.capabilities.indexOf('Query') > -1))
          ) {
            isFeatureLayer = true;
            type = 'esri.layers.FeatureLayer';
          } else if (
            info.layerObject && info.layerObject.url &&
            /\/MapServer\/\d+$/.test(info.layerObject.url) &&
            info.isTable === false
          ) {
            isFeatureLayer = true;
            type = 'esri.layers.FeatureLayer';
          }

          var node = {
            id: info.id,
            title: info.title,
            type: type,
            isFeatureLayer: isFeatureLayer,
            isGroupLayer: isGroupLayer,
            parent: parentTitle || (info.parentLayerInfo ? info.parentLayerInfo.title : null),
            url: info.url || (info.layerObject && info.layerObject.url),
            children: []
          };

          return getFieldTypesDictAsync(info).then(function(fieldsDict) {
            node.fields = fieldsDict;
            if (isGroupLayer && info.getSubLayers && typeof info.getSubLayers === 'function') {
              var sublayers = info.getSubLayers();
              if (sublayers && sublayers.length > 0) {
                return Promise.all(sublayers.map(function(sub) {
                  return gatherAsync(sub, info.title);
                })).then(function(children) {
                  node.children = children;
                  return node;
                });
              }
            }
            return node;
          });
        }

        // Return a promise that resolves to the tree, and cache it
        this._layerTreePromise = Promise.all(layerInfos.map(function(info) { return gatherAsync(info, null); }));
        return this._layerTreePromise;
      },

      // 2. Log the structure recursively
      _logLayerTree: function(tree, indent) {
        indent = indent || '';
        tree.forEach(function(node) {
          var label = node.isGroupLayer ? '[Group]' : node.isFeatureLayer ? '[Feature]' : '[Other]';
          var logObj = {
            id: node.id,
            title: node.title,
            type: node.type,
            isFeatureLayer: node.isFeatureLayer,
            isGroupLayer: node.isGroupLayer,
            parent: node.parent,
            url: node.url
          };
          if (node.isFeatureLayer && node.fields) {
            logObj.fields = node.fields;
          }
          console.log(indent + label, logObj);
          if (node.children && node.children.length > 0) {
            this._logLayerTree(node.children, indent + '  ');
          }
        }, this);
      },

      // 3. Main beefcake: _applyMultiLayerFilter
      _applyMultiLayerFilter: function(expr, enableMapFilter, mainLayerId) {
        this._getLayerTree().then(lang.hitch(this, function(tree) {

          // Logging!
          console.log('[MultiFilter] Layer tree structure:', tree);
          console.log('[MultiFilter] Incoming SQL query:', expr);

          // Skip if filter expression is empty or only whitespace
          if (!expr || !expr.trim()) {
            // Clear all filters applied by this widget for all feature layers
            function collectFeatureLayerNodes(nodeList) {
              var nodes = [];
              nodeList.forEach(function(node) {
                if (node.isFeatureLayer) {
                  nodes.push(node);
                }
                if (node.children && node.children.length > 0) {
                  nodes = nodes.concat(collectFeatureLayerNodes(node.children));
                }
              });
              return nodes;
            }
            var featureLayerNodes = collectFeatureLayerNodes(tree);
            featureLayerNodes.forEach(function(node) {
              if (node.fields) {
                // Remove the filter by passing an empty string
                this.filterManager.applyWidgetFilter(node.id, this.id, "", false, null, this.config.zoomto);
              }
            }, this);
            return;
          }

          // Detect tautology filter (e.g., 1=1, (1=1), 0=0, (0=0))
          var normalized = expr && expr.replace(/\s+/g, '').toLowerCase();
          if (normalized === '1=1' || normalized === '(1=1)' || normalized === '0=0' || normalized === '(0=0)') {
            // Apply the tautology filter to all feature layers (except mainLayerId if you want to skip it)
            function collectFeatureLayerNodes(nodeList) {
              var nodes = [];
              nodeList.forEach(function(node) {
                if (node.isFeatureLayer) {
                  nodes.push(node);
                }
                if (node.children && node.children.length > 0) {
                  nodes = nodes.concat(collectFeatureLayerNodes(node.children));
                }
              });
              return nodes;
            }
            var featureLayerNodes = collectFeatureLayerNodes(tree);
            featureLayerNodes.forEach(function(node) {
              if (node.fields) {
                this.filterManager.applyWidgetFilter(node.id, this.id, expr, enableMapFilter, null, this.config.zoomto);
              }
            }, this);
            return; // Skip the rest of the function
          }

          // --- Tokenizer: supports all relevant SQL operators ---
          // --- Tokenizer: also, LOWER and UPPER as tokens ---
          function tokenize(sql) {
            var re = /\s*(=>|<=|>=|<>|!=|=|<|>|\bAND\b|\bOR\b|\bNOT\b|\bIS\b|\bNULL\b|\bLIKE\b|\bIN\b|\bLOWER\b|\bUPPER\b|\(|\)|,|[a-zA-Z_][a-zA-Z0-9_]*|'[^']*'|"(?:[^"]|\\")*"|\d+\.\d+|\d+)\s*/gi;
            var tokens = [];
            var m;
            while ((m = re.exec(sql)) !== null) {
              tokens.push(m[1]);
            }
            return tokens;
          }

          // --- Parser: builds AST for WHERE expressions ---
          function parse(tokens) {
            var pos = 0;
            function peek() { return tokens[pos]; }
            function next() { return tokens[pos++]; }

            // --- Parser: handle LOWER(field) and UPPER(field) ---
            function parseField() {
              var token = next();
              if ((token && token.toUpperCase() === 'LOWER') || (token && token.toUpperCase() === 'UPPER')) {
                var func = token.toUpperCase();
                if (next() !== '(') throw new Error('Expected ( after ' + func);
                var field = next();
                if (next() !== ')') throw new Error('Expected ) after ' + func + '(' + field);
                return { type: 'FIELD', field: field, func: func }; // Mark as wrapped
              }
              return { type: 'FIELD', field: token };
            }

            function parsePrimary() {
              if (peek() === '(') {
                next();
                var expr = parseExpr();
                if (next() !== ')') throw new Error('Expected )');
                return expr;
              }
              if (peek() && peek().toUpperCase() === 'NOT') {
                next();
                return { type: 'NOT', expr: parsePrimary() };
              }
              var fieldObj = parseField();
              var field = fieldObj.field;
              var fieldFunc = fieldObj.func; // 'LOWER' or 'UPPER' or undefined
              var op = next();
              if (!op) return { type: 'FIELD', field: field };
              op = op.toUpperCase();

              // IS [NOT] NULL
              if (op === 'IS') {
                var maybeNot = peek() && peek().toUpperCase() === 'NOT';
                if (maybeNot) next();
                var maybeNull = peek() && peek().toUpperCase() === 'NULL';
                if (maybeNull) next();
                if (maybeNot && maybeNull) {
                  return { type: 'IS NOT NULL', field: field };
                } else if (maybeNull) {
                  return { type: 'IS NULL', field: field };
                }
                // IS [NOT] <value>
                var value = next();
                return { type: maybeNot ? 'IS NOT' : 'IS', field: field, value: value };
              }
              // LIKE, NOT LIKE
              if (op === 'LIKE' || (op === 'NOT' && tokens[pos] && tokens[pos].toUpperCase() === 'LIKE')) {
                if (op === 'NOT') next();
                var value = next();
                return { type: op === 'LIKE' ? 'LIKE' : 'NOT LIKE', field: field, value: value };
              }
              // IN, NOT IN
              if (op === 'IN' || (op === 'NOT' && tokens[pos] && tokens[pos].toUpperCase() === 'IN')) {
                if (op === 'NOT') next();
                if (next() !== '(') throw new Error('Expected ( after IN');
                var vals = [];
                while (peek() && peek() !== ')') {
                  var v = next();
                  if (v === ',') continue;
                  vals.push(v);
                }
                if (next() !== ')') throw new Error('Expected ) after IN values');
                return { type: op === 'IN' ? 'IN' : 'NOT IN', field: field, values: vals };
              }
              // Standard binary op
              var value = next();
              return { type: 'COND', field: field, op: op, value: value, func: fieldFunc };
            }

            function parseAnd() {
              var left = parsePrimary();
              while (peek() && peek().toUpperCase() === 'AND') {
                next();
                var right = parsePrimary();
                left = { type: 'AND', left: left, right: right };
              }
              return left;
            }

            function parseOr() {
              var left = parseAnd();
              while (peek() && peek().toUpperCase() === 'OR') {
                next();
                var right = parseAnd();
                left = { type: 'OR', left: left, right: right };
              }
              return left;
            }

            function parseExpr() {
              return parseOr();
            }

            return parseExpr();
          }

          // --- Prune AST: remove nodes referencing missing fields, preserve logic ---
            function prune(ast, fieldKeys) {
              if (!ast) return null;
              var fieldName = ast.field;
              if (ast.func) {
                fieldName = ast.field; // Use the inner field name for matching
              }
            switch (ast.type) {
              case 'AND':
              case 'OR': {
                var left = prune(ast.left, fieldKeys);
                var right = prune(ast.right, fieldKeys);
                if (left && right) return { type: ast.type, left: left, right: right };
                if (ast.type === 'AND') return left || right;
                if (ast.type === 'OR') return left || right;
                return null;
              }
              case 'NOT':
                var expr = prune(ast.expr, fieldKeys);
                return expr ? { type: 'NOT', expr: expr } : null;
              case 'COND':
              case 'LIKE':
              case 'NOT LIKE':
              case 'IN':
              case 'NOT IN':
              case 'IS':
              case 'IS NOT':
              case 'IS NULL':
              case 'IS NOT NULL':
                if (fieldKeys.indexOf(fieldName.toLowerCase()) !== -1) return ast;
                return null;
              case 'FIELD':
                if (fieldKeys.indexOf(fieldName.toLowerCase()) !== -1) return ast;
                return null;
              default:
                return null;
            }
          }

          // --- Rebuild SQL from AST ---
          function toSQL(ast) {
            if (!ast) return '';
            switch (ast.type) {
              case 'AND':
                return '(' + toSQL(ast.left) + ' AND ' + toSQL(ast.right) + ')';
              case 'OR':
                return '(' + toSQL(ast.left) + ' OR ' + toSQL(ast.right) + ')';
              case 'NOT':
                return '(NOT ' + toSQL(ast.expr) + ')';
              case 'COND':
                // If there's a func, wrap the field
                var fieldExpr = ast.func ? (ast.func + '(' + ast.field + ')') : ast.field;
                return fieldExpr + ' ' + ast.op + ' ' + ast.value;
              case 'LIKE':
              case 'NOT LIKE':
              case 'IN':
              case 'NOT IN':
              case 'IS':
              case 'IS NOT':
              case 'IS NULL':
              case 'IS NOT NULL':
                var fieldExpr = ast.func ? (ast.func + '(' + ast.field + ')') : ast.field;
                // Use fieldExpr in all these cases
                switch (ast.type) {
                  case 'LIKE': return fieldExpr + ' LIKE ' + ast.value;
                  case 'NOT LIKE': return fieldExpr + ' NOT LIKE ' + ast.value;
                  case 'IN': return fieldExpr + ' IN (' + ast.values.join(', ') + ')';
                  case 'NOT IN': return fieldExpr + ' NOT IN (' + ast.values.join(', ') + ')';
                  case 'IS': return fieldExpr + ' IS ' + ast.value;
                  case 'IS NOT': return fieldExpr + ' IS NOT ' + ast.value;
                  case 'IS NULL': return fieldExpr + ' IS NULL';
                  case 'IS NOT NULL': return fieldExpr + ' IS NOT NULL';
                }
              case 'FIELD':
                return ast.func ? (ast.func + '(' + ast.field + ')') : ast.field;
              default:
                return '';
            }
          }

          function collectFeatureLayerNodes(nodeList, excludeId) {
            var nodes = [];
            nodeList.forEach(function(node) {
              if (node.isFeatureLayer && node.id !== excludeId) {
                nodes.push(node);
              }
              if (node.children && node.children.length > 0) {
                nodes = nodes.concat(collectFeatureLayerNodes(node.children, excludeId));
              }
            });
            return nodes;
          }

          // --- Main logic: all runs after tree is ready ---
          var tokens, ast;
          try {
            tokens = tokenize(expr);
            ast = parse(tokens);
          } catch (e) {
            console.error('[MultiFilter] Failed to parse SQL:', expr, e);
            return;
          }

          // Field extraction for logging
          function collectFields(ast, arr) {
            if (!ast) return;
            switch (ast.type) {
              case 'AND':
              case 'OR':
                collectFields(ast.left, arr);
                collectFields(ast.right, arr);
                break;
              case 'NOT':
                collectFields(ast.expr, arr);
                break;
              case 'COND':
              case 'LIKE':
              case 'NOT LIKE':
              case 'IN':
              case 'NOT IN':
              case 'IS':
              case 'IS NOT':
              case 'IS NULL':
              case 'IS NOT NULL':
              case 'FIELD':
                // Always push the inner field name, not the wrapper (LOWER/UPPER)
                arr.push(ast.field);
                break;
            }
          }
          var allFields = [];
          collectFields(ast, allFields);
          allFields = allFields.map(function(f) { return f && f.toLowerCase(); })
            .filter(function(f, i, arr) { return f && arr.indexOf(f) === i; });
          console.log('[MultiFilter] Filter fields:', allFields);

          var featureLayerNodes = collectFeatureLayerNodes(tree, mainLayerId);

          featureLayerNodes.forEach(function(node) {
            if (!node.fields) return;
            var fieldKeys = Object.keys(node.fields).map(function(f) { return f.toLowerCase(); });

            var prunedAst = prune(ast, fieldKeys);
            var partialExpr = toSQL(prunedAst);

            // Find missing fields for logging
            var missingFields = allFields.filter(function(f) {
              return fieldKeys.indexOf(f) === -1;
            });

            if (partialExpr && partialExpr !== '' && partialExpr !== '()') {
              if (missingFields.length > 0) {
                console.warn('[MultiFilter] Layer', node.id, 'is missing fields:', missingFields, '| Applying partial filter:', partialExpr);
              } else {
                console.log('[MultiFilter] Applying filter to layer:', node.id, '| Expression:', partialExpr);
              }
              this.filterManager.applyWidgetFilter(node.id, this.id, partialExpr, enableMapFilter, null, this.config.zoomto);
            } else {
              console.warn('[MultiFilter] Layer', node.id, 'has no matching fields for filter. Missing fields:', missingFields);
            }
          }, this);
        }));
      },

      _setItemFilter: function(layerId, idx, expr, enableMapFilter) {
        if(!this._store[layerId]){
          return true;
        }
        this._store[layerId]['filter_item_' + idx] = expr;

        var priority = this._getPriorityOfMapFilter(layerId);
        lang.setObject(layerId + '.mapFilterControls.filter_item_' + idx , {
          enable: enableMapFilter,
          priority: priority + 1
        }, this._store);
      },

      _removeItemFilter: function(layerId, idx) {
        if(!this._store[layerId]){
          return true;
        }
        delete this._store[layerId]['filter_item_' + idx];
        delete this._store[layerId].mapFilterControls['filter_item_' + idx];
      },

      //combine all the filter task
      _getExpr: function(layerId) {
        if (!this._store[layerId]) {
          return null;
        }

        var parts = [];
        var exprs = this._store[layerId];

        for (var p in exprs) {
          var expr = exprs[p];
          if (expr && p !== 'mapFilterControls') {
            parts.push('(' + expr + ')');
          }
        }

        // return parts.join(' AND ');
        return parts.join(' ' + this.config.taskOper + ' '); //by filters's operator
      },

      toggleFilter: function(node, filterObj, parse) {
        if(html.getAttr(node, 'aria-disabled') === 'true'){
          html.removeClass(node, 'applied');
          node.toggleButton.uncheck();
          return;
        }
        if (html.hasClass(node, 'config-parameters') &&
          !(node.filterParams && node.filterParams.getFilterExpr())) {
          return;
        }
        if (parse.isAskForValue && !(node.filterParams && node.filterParams.getFilterExpr())) {
          this.configFilter(node, filterObj);
          return;
        }
        // if(node.toggleButton.isDoing){
        //   return;
        // }

        var isError = false;
        var layerId = filterObj.layerId;
        var idx = html.getAttr(node, 'data-index');

        var applied = html.hasClass(node, 'applied');
        if (applied) {
          html.removeClass(node, 'applied');
          node.toggleButton.uncheck();
        } else {
          html.addClass(node, 'applied');
          node.toggleButton.check();
        }

        if (!applied) {
          var expr = this._getFilterExpr(node, filterObj);
          isError = this._setItemFilter(layerId, idx, expr, filterObj.enableMapFilter);
        } else {
          isError = this._removeItemFilter(layerId, idx);
        }
        if(isError){
          this._setFilterNodeError(node, layerId);
          html.removeClass(node, 'applied');
          node.toggleButton.uncheck();
          return;
        }
        var layerFilterExpr = this._getExpr(layerId);
        var enableMapFilter = this._getMapFilterControl(layerId);
        this.filterManager.applyWidgetFilter(layerId, this.id, layerFilterExpr, enableMapFilter, null, this.config.zoomto);
        this._applyMultiLayerFilter(layerFilterExpr, enableMapFilter, layerId);

        this._afterFilterApplied(filterObj.layerId, !node.toggleButton.checked);
      },

      configFilter: function(node, filterObj, evt, cb) {
        if(!html.hasClass(node, 'has-ask-for-value')){//prevent error data
          return;
        }
        if (!node.filterParams) {
          var layerInfo = this.layerInfosObj.getLayerInfoById(filterObj.layerId);
          if(layerInfo){
            layerInfo.getLayerObject().then(lang.hitch(this, function(layerObject){
              html.addClass(node, 'config-parameters');
              html.removeClass(node, 'requesting');
              var pamDiv = query('.parameters', node)[0];
              node.handles = [];
              node.filterParams = new FilterParameters();
              var partsObj = lang.clone(filterObj.filter);

              var layerId = null;
              if(filterObj.enableMapFilter){
                //if enableMapFilter is true, pass layerId to filterParams,
                //so filterParams can get the layer expr defined in webmap
                layerId = filterObj.layerId;
              }

              //wid + layerid + nodeIndex, because its spacial dom structure.
              // partsObj.wId = 'widgets_Filter_Widget' + this.id + '_' + html.getAttr(node, 'data-index');
              var wid = this.isOnScreen ? ('widgets_Filter_Widget' + this.id) : this.id;
              partsObj.wId = wid + '_' + layerObject.id + '_' + html.getAttr(node, 'data-index');
              var buildDef = node.filterParams.build(filterObj.url, layerObject, partsObj, layerId, this.id);

              this.own(on(node.filterParams, 'change', lang.hitch(this, function(expr) {
                if (expr) {
                  node.expr = expr;
                } else {
                  delete node.expr;
                }

                if(node.toggleButton.checked){
                  this.applyFilterValues(node, filterObj);
                }

              })));

              node.expr = node.filterParams.getFilterExpr();
              node.filterParams.placeAt(pamDiv);
              this._changeItemTitleWidth(node, 60);
              if(cb){
                cb(buildDef);
              }
            }));
          }else if(cb){//handle the error layer data
            cb(null, true);
          }
        } else {
          //to do... to confirm how to enter this condition.
          if (!html.hasClass(node, 'config-parameters')) {
            html.addClass(node, 'config-parameters');
            this._changeItemTitleWidth(node, 60);
          } else {
            html.removeClass(node, 'config-parameters');
            this._changeItemTitleWidth(node, window.appInfo.isRunInMobile ? 60 : 45);
          }
          if(cb){
            cb();
          }
        }

        if (evt && evt.target) {
          evt.stopPropagation();
        }
      },

      applyFilterValues: function(node, filterObj, evt) {
        var expr = this._getFilterExpr(node, filterObj);
        if (expr) {
          node.expr = expr;
          // getFilterExpr
          var layerId = filterObj.layerId;
          var idx = html.getAttr(node, 'data-index');
          html.addClass(node, 'applied');
          this._setItemFilter(layerId, idx, node.expr, filterObj.enableMapFilter);
          var layerFilterExpr = this._getExpr(layerId);
          var enableMapFilter = this._getMapFilterControl(layerId);
          this.filterManager.applyWidgetFilter(layerId, this.id, layerFilterExpr, enableMapFilter, null, this.config.zoomto);
          this._applyMultiLayerFilter(layerFilterExpr, enableMapFilter, layerId);

          this._afterFilterApplied(filterObj.layerId);
        }

        if(evt){
          evt.stopPropagation();
        }
      },

      _getFilterExpr: function(node, filterObj){
        if(node.filterParams){
          return node.filterParams.getFilterExpr();
        }

        if(this.filterUtils.hasVirtualDate(filterObj.filter)){
          this.filterUtils.isHosted = jimuUtils.isHostedService(filterObj.url);
          return this.filterUtils.getExprByFilterObj(filterObj.filter);
        }else{
          return filterObj.filter.expr;
        }

      },

      _afterFilterApplied: function(layerId, isCheck){
        if(!this.config.zoomto && !this.config.zoombackto){
          return;
        }
        var layerInfo = this.layerInfosObj.getLayerInfoById(layerId);
        if(!isCheck){ //turn on
          if(this.config.zoomto && layerInfo){
            layerInfo.zoomTo();
          }
        }else{ //turn off
          if(this.config.zoombackto){
            var isAllOff = this._checkIfAllOffByLayer(layerId);
            if(isAllOff){
              this.map.setExtent(this.homeExtent);
              return;
            }
          }
          if(this.config.zoomto && layerInfo){
            layerInfo.zoomTo();
          }
        }
      },

      //check if all filters of current layer are off
      _checkIfAllOffByLayer: function(layerId){
        var isAllOff = true;
        if(this.config.allowCustom && this.customFilterToggleButton.checked &&
          this.customFilter && this.customFilter.featureLayerId === layerId){
          var filterJson = this.customFilter.toJson();
          if(filterJson &&  filterJson.parts.length > 0){
            return !isAllOff;
          }
        }
        var nodes = query('li', this.filterList);
        for(var i = 0; i < nodes.length; i++){
          var node = nodes[i];
          if(node.toggleButton.checked && node.currentLayerId === layerId){
            isAllOff = false;
            break;
          }
        }
        return isAllOff;
      },

      _isValidExtent: function(extent){
        return !(isNaN(extent.xmax) || isNaN(extent.xmax) ||
          isNaN(extent.xmax) || isNaN(extent.xmax));
      },

      resize: function() {
        this.inherited(arguments);
        // this._changeItemTitleWidth(this.domNode, window.appInfo.isRunInMobile ? 60 : 45);
        this._changeItemTitleWidth(this.domNode, window.appInfo.isRunInMobile ? 60 : 70);
        if(this.customFilter){
          this.customFilter.resize();
        }
      },

      _changeItemTitleWidth: function(node, tolerace) {
        tolerace += 30;
        var itemHeader = query('.header', node)[0];
        if (itemHeader) {
          var contentBox = html.getContentBox(itemHeader);
          var maxWidth = contentBox.w - tolerace;// width of header minus others width
          if (maxWidth > 0) {
            query('.header .item-title', node).style({
              'maxWidth': maxWidth + 'px'
            });
          }
        }
      },

      _hideFilterActions: function(isHidden){
        var value = isHidden ? 'none' : 'block';
        if(this.filterActions.length > 1){
          html.setStyle(this.showFilterActionsButtonNode, 'display', value);
        }
        this.filterActions.forEach(function(actionNode){
          html.setStyle(actionNode, 'display', value);
        });
      },

      // events for action list
      _onShowCustomClick: function(evt){
        html.setStyle(this.customFilterContainerNode, 'display', 'block');
        html.setStyle(this.filterListContainerNode, 'display', 'none');
        this._hideFilterActions(true);

        if(!this.layerChooserSelect){
          var layerChooser = new CustomFeaturelayerChooserFromMap({
            showLayerFromFeatureSet: false,
            showTable: false,
            onlyShowVisible: false,
            createMapResponse: this.map.webMapResponse
          });
          this.layerChooserSelect = new LayerChooserFromMapWithDropbox({
            layerChooser: layerChooser
          });
          this.layerChooserSelect.placeAt(this.layerSelectNode);

          this.own(on(this.layerChooserSelect, 'selection-change', lang.hitch(this, this._onLayerChanged)));

          this.own(on(this.layerChooserSelect.dropDownBtn, 'keydown', lang.hitch(this, function(evt){
            if(!evt.shiftKey && evt.keyCode === keys.TAB && this.layerChooserSelect._selectedItem === null){
              evt.preventDefault();
              focusUtil.focus(this.customBackNode);
            }
          })));

          this.layerChooserSelect.showLayerChooser();
        }
        evt.preventDefault();
        focusUtil.focus(this.customFilterToggleButton.domNode);
      },

      // reset filters by config, not affect customFilter's filters
      _onShowResetAllClick: function(){
        this._destroyFilterParams();
        this._unapplyFilterByStore();
        this._store = {};
        dojo.empty(this.filterList);
        // zoom to map's initial extent
        this.map.setExtent(this.homeExtent);
        // reset filters, and will zoom to applied filters by config
        this.initAllFilters();
      },

      // turn off all toggle btns, not affect customFilter's filters
      _onShowTurnOffAllClick: function(){
        var isTurnOff = false;
        var nodes = query('li', this.filterList);
        nodes.some(function(node){
          if(node.toggleButton.checked){
            isTurnOff = true;
            return true;
          }
        });
        if(isTurnOff){
          this._unapplyFilterByStore();
          nodes.forEach(function(node){
            if(node.toggleButton.checked){
              html.removeClass(node, 'applied');
              node.toggleButton.uncheck();
              //remove item filter from store
              var idx = html.getAttr(node, 'data-index');
              this._removeItemFilter(node.currentLayerId, idx);
            }
          }, this);
          this.map.setExtent(this.homeExtent);
        }
      },

      _onShowCustomKeydown: function(evt){
        if(evt.keyCode === keys.ENTER || evt.keyCode === keys.SPACE){
          this._onShowCustomClick(evt);
        }
      },

      _onShowResetAllKeydown: function(evt){
        if(evt.keyCode === keys.ENTER || evt.keyCode === keys.SPACE){
          this._onShowResetAllClick(evt);
        }
      },

      _onShowTurnOffAllKeydown: function(evt){
        if(evt.keyCode === keys.ENTER || evt.keyCode === keys.SPACE){
          this._onShowTurnOffAllClick(evt);
        }
      },

      _onLayerChanged: function(){
        var item = this.layerChooserSelect.getSelectedItem();
        if(!item){
          return;
        }
        //nameTextBox
        var layerInfo = item.layerInfo;
        var layer = layerInfo.layerObject;
        //filter
        // var layerDefinition = this._getLayerDefinitionForFilterDijit(layer);

        if(!this.customFilter){
          this.customFilter = new Filter({
            enableAskForValues: false,
            featureLayerId: layer.id,
            runtime: true,
            widgetId: this.id
          });
          this.customFilter.placeAt(this.customFilterNode);
          this.own(on(this.customFilter, 'change', lang.hitch(this, this._onCustomFilterChange)));
          //last node to first node on custom filter for mobile mode.
          this.own(on(this.customFilter.btnAddSetMobile, 'keydown', lang.hitch(this, this._btnAddSetToToggleBtn)));
        } else {
          this._applyCustomFilter(true); // remove expr from previous layer
        }

        this.customFilter.build({
          url: layer.url,
          featureLayerId: layer.id, // featureLayerId is necessary
          // layerDefinition: layerDefinition
          layerDefinition: layer
        });

        this.selectedLayer = layer;
      },

      _btnAddSetToToggleBtn: function(evt){
        if(!evt.shiftKey && evt.keyCode === keys.TAB){
          evt.preventDefault();
          focusUtil.focus(this.customBackNode);
        }
      },

      _getLayerDefinitionForFilterDijit: function(layer){
        var layerDefinition = null;

        if(layer.declaredClass === 'esri.layers.FeatureLayer'){
          layerDefinition = jimuUtils.getFeatureLayerDefinition(layer);
        }

        if (!layerDefinition) {
          layerDefinition = {
            currentVersion: layer.currentVersion,
            fields: lang.clone(layer.fields)
          };
        }

        return layerDefinition;
      },

      _onBackToListClick: function(){
        html.setStyle(this.customFilterContainerNode, 'display', 'none');
        html.setStyle(this.filterListContainerNode, 'display', 'block');
        this._hideFilterActions(false);
        focusUtil.focus(this.showCustomButtonNode);
      },

      _onBackToListKeydown: function(evt){
        if(evt.keyCode === keys.ENTER || evt.keyCode === keys.SPACE){
          this._onBackToListClick();
        }else if(evt.shiftKey && evt.keyCode === keys.TAB){//tab to last node on custom filter
          evt.preventDefault();
          if(this.layerChooserSelect._selectedItem === null){
            focusUtil.focus(this.layerChooserSelect.dropDownBtn);
          }else{
            //mobile mode
            if(!html.hasClass(this.customFilter.mobileAddSection, 'hidden')){
              focusUtil.focus(this.customFilter.btnAddSetMobile);
            }
          }
        }
      },

      _onCustomFilterToggle: function(isChecked){
        if(!this.customFilter){
          return;
        }
        if(!isChecked){
          this.filterManager.applyWidgetFilter(this.selectedLayer.id, this.id + '-custom-filter', '1=1', true, null, this.config.zoomto);
          this._applyMultiLayerFilter('1=1', true, this.selectedLayer.id);
          this._afterFilterApplied(this.selectedLayer.id, true);
        }else{
          this._applyCustomFilter();
        }
      },

      _onCustomFilterChange: function(){
        this._applyCustomFilter();
      },

      _applyCustomFilter: function(isReset){
        if(!this.customFilterToggleButton.checked){
          return;
        }
        var wFilterId = this.id + '-custom-filter';
        var previousExpr = this.filterManager.getWidgetFilter(this.selectedLayer.id, wFilterId);
        var newExpr = isReset ? '1=1' : this.customFilter.toValidJson().expr;
        // Do not apply filters when: Process from Changing a layer to Completing the first valid expression, or expr is not changed.
        if((!previousExpr && newExpr === '1=1') || previousExpr === newExpr){
          return;
        }
        this.filterManager.applyWidgetFilter(this.selectedLayer.id, wFilterId, newExpr, true, null, this.config.zoomto);
        this._applyMultiLayerFilter(newExpr, true, this.selectedLayer.id);
        this._afterFilterApplied(this.selectedLayer.id);
      },

      _destroyFilterParams: function(){
        query('.filter-item', this.filterList).forEach(function(node) {
          if(node.filterParams){
            node.filterParams.destroy();
          }
          delete node.expr;
        });
      },

      _unapplyFilterByStore: function(){
        if (this._store) {
          for (var p in this._store) {
            if (p) {
              this.filterManager.applyWidgetFilter(p, this.id, "", null, null, this.config.zoomto);
              this._applyMultiLayerFilter("", null, p);
            }
          }
        }
      },

      destroy: function(){
        this._destroyFilterParams();
        this._unapplyFilterByStore();
        this.inherited(arguments);
      }
    });
  });