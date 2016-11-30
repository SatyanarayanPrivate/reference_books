(function() {
    function log(text) {
        window['__ATA_DEBUG'] &&
            (typeof console !== 'undefined') &&
            (console.info) &&
            console.info(new Date(), ' -> ', text.replace('http', 'htt_p'));
    }

    var AD_SERVER_URL = '//s.pubmine.com/';

    // !!! [VERY IMPORTANT] !!!!
    // this must exactly match variable name in global scope, which must contain displayAd function
    // it is used to connect this lib with global object
    var globalLinkName = '__ATA',
        globalPart = window[globalLinkName],
        SLOT_ID_PREFIX = globalPart.slotPrefix,
        SERVER_RESPONSE_HANDLER_NAME = 'automattic_jsonp_handler',
        PASSBACK_RECEIVER_NAME = globalPart.passbackReceiver,
        PASSBACK_SRC = globalPart.passbackSrc,
        PASSBACK_ORIGIN = (PASSBACK_SRC.match(/^(?:[a-z]+\:)?(?:\/\/)?[a-zA-Z0-9_\-\.]+/) || [''])[0];

    if (PASSBACK_ORIGIN.search(/https?\:\/\//)) {
        PASSBACK_ORIGIN = location.protocol + PASSBACK_ORIGIN;
    }

    // setup inheritance. AdBase must be prototype for both our classes
    // it contains only basic functions, which I want to be accessible from
    // manager and renderer
    AdManager.prototype = new AdBase();
    AdManager.prototype.constructor = AdManager;
    AdRenderer.prototype = new AdBase();
    AdRenderer.prototype.constructor = AdRenderer;

    var adm = new AdManager(globalPart);
    /**
     * Instance of this class rules server request and processing.
     * It creates real displayAd function, which is called on ad tag render
     * or server response receiving.
     * @class AdManager
     * @extends AdBase
     * @param {Object} linkToGlobalPart
     */
    function AdManager(linkToGlobalPart) {
        var me = this;

        var knownParams = ['section_id', 'tz', 'fl', 'click3rd', 'slot_id', 'ref', 'pos'];

        this.slotsDefs = {};

        this.passbackInited = false;

        /**
         * Links AdManager to global object.
         * @property {Object} globalPart
         */
        this.globalPart = linkToGlobalPart;
        /**
         * Link between AdManager and AdRenderer
         * @property {AdRenderer} adRenderer
         */
        this.adRenderer = new AdRenderer(this);

        this.getSlotDefById = function(slotId) {
            return this.slotsDefs[slotId];
        };

        this.initPassbackWorkflow = function () {
            //return if it is already inited
            if (me.passbackInited) return;
            me.passbackInited = true;
            //create receiver iframe, to passback.html could detected main iframe
            var receiver = document.createElement('iframe');
            receiver.style.cssText = 'position:absolute;left:-1000px;top:-1000px;border:0 solid;width:0;height:0;';
            receiver.width = receiver.height = 0;
            receiver.name = PASSBACK_RECEIVER_NAME;
            receiver.src = PASSBACK_SRC + '#' + location.protocol + '//' + location.host;
            document.body.appendChild(receiver);

            /**
             * Passback handler.
             * @param {DOMObject} fif - iframe, from which was sended passback
             */
            me.onPassbackReceived = me.globalPart['onPassbackReceived'] = function(fif) {
                var slotDef, slotId = fif.id;
                slotId = slotId && slotId.replace('fif_slot_' + SLOT_ID_PREFIX + '_','');
                slotDef = me.getSlotDefById(slotId);
                if (slotDef && slotDef.subs && slotDef.subs.length) {

                    // hide and remove iframe, from which came passback, and mark it as dead
                    try {
                        fif.id = fif.name = 'dead_' + fif.name;
                        fif.style.cssText = 'border:none;position:absolute;width:0;height:0;left:-10000px;top:-10000px;';
                        var fifWindow = fif.contentWindow;
                        fifWindow.name = fif.id;
                        if (fifWindow && fifWindow.document && fifWindow.document.readyState === 'complete') {
                            fif.parentNode && fif.parentNode.removeChild(fif);
                        }
                    } catch(err){}

                    var slot = slotDef.subs.shift();

                    if (slotDef.passbackUrl) {
                        (new Image()).src = slotDef.passbackUrl;
                    }
                    if (slot['noad_url']) {
                        (new Image()).src = slot['noad_url'];
                    }

                    slotDef = {
                        slotId: slotId,
                        sectionId: slotDef.sectionId,
                        data: slot['data'],
                        type: slotDef.type,
                        width: slotDef.width,
                        height: slotDef.height,
                        subs: slotDef.subs,
                        passbackUrl: slot['passback_url']
                    };

                    // add slot definition into storage variable
                    me.slotsDefs[slotDef.slotId] = slotDef;

                    me.adRenderer.renderSlot(me.isSyncMode(), slotDef);
                }
            };
            //postmessage handler
            me.adRenderer.addEvent(window, 'message', function(e){
                if (e.origin === PASSBACK_ORIGIN && e.source) {
                    var fifWin = e.source, p = fifWin.parent;
                    while (p !== window && p !== window.top) {
                        fifWin = p;
                        p = p.parent;
                    }
                    if (fifWin && p === window) {
                        try {
                            me.onPassbackReceived(fifWin.frameElement);
                        } catch(err) {
                            log('No access to iframe from postMessage ' + err);
                        }
                    }
                }
            });
        };

        /**
         * Main displaying function.
         * @param {String} slotId
         */
        this.displayAd = this.globalPart['displayAd'] = function(slotId, customParams) {
            log('<span class="blue">displayAd is called for ID:</span> ' + slotId);
            var ids = me.globalPart['ids'];
            if (ids && ids[slotId]) {
                delete ids[slotId]; // remove slot from 'to-be-rendered' map
            }
            var adTagEl, type, scriptTag, baseUrl, completeAdServerUrl, width, height, slotDef;
            adTagEl = document.getElementById(slotId);
            width = parseInt(adTagEl.style.width, 10);
            height = parseInt(adTagEl.style.height, 10);
            type = adTagEl.getAttribute('data-type') || 'adj';
            baseUrl = AD_SERVER_URL;
            slotDef = {
                slotId: slotId,
                sectionId: adTagEl.getAttribute('data-section'),
                forcedUrl: adTagEl.getAttribute('data-forcedurl'),
                customParams: customParams,
                type: type,
                width: width,
                height: height
            };
            completeAdServerUrl = slotDef.forcedUrl || me.generateAdServerUrl(baseUrl, slotDef);

            log('Ad server full URL: ' + completeAdServerUrl);
            me.requestAd(slotDef, completeAdServerUrl);
            //me.adRenderer.renderSlot(me.isSyncMode(), slotDef, completeAdServerUrl);
        };

        this.addJsonpHandler = function(slotDef, completeAdServerUrl) {
            var handlerName,
                handler = this.serverResponseHandler,
                handlerScope = this;

            handlerName = (SERVER_RESPONSE_HANDLER_NAME + '_' + slotDef.slotId).replace(/[^a-zA-Z0-9_\$]/g,'_');

            window[handlerName] = function (slotData) {
                try {
                    delete window[handlerName];
                } catch(err) {
                    window[handlerName] = undefined;
                }
                var scriptId = 'slots_script_' + slotDef.slotId;
                var scriptEl = document.getElementById(scriptId);
                if (scriptEl) {
                    scriptEl.parentNode.removeChild(scriptEl);
                }
                handler.call(handlerScope, slotData, slotDef);
            };
            var ind = completeAdServerUrl.indexOf('?');
            return completeAdServerUrl + ((ind > -1? '&' : '?') + 'callbackPubmine=' + handlerName);
        };

        this.requestAd = function(slotDef, completeAdServerUrl) {
            var scriptTag, scriptEl, scriptId, firstScriptNode;
            completeAdServerUrl = me.addJsonpHandler(slotDef, completeAdServerUrl);
            scriptId = 'slots_script_' + slotDef.slotId;
            if (me.isSyncMode()){
                // sync request
                scriptTag = '\x3Cscript type=\"text/javascript\" src=\"{{url}}\" id=\"{{id}}\">\x3C\/script>';
                scriptTag = scriptTag.replace('{{url}}', completeAdServerUrl).replace('{{id}}', scriptId);
                document.write(scriptTag);
            } else {
                // async request
                scriptEl = document.createElement('script');
                scriptEl.async = true;
                scriptEl.type = 'text/javascript';
                scriptEl.src = completeAdServerUrl;
                scriptEl.id = scriptId;
                // we have at least one script tag, because of ours head snippet
                firstScriptNode = document.getElementsByTagName('script')[0];

                if (me.isPresto()){
                    setTimeout(function(){
                        firstScriptNode.parentNode.insertBefore(scriptEl, firstScriptNode);
                    }, 0);
                } else {
                    firstScriptNode.parentNode.insertBefore(scriptEl, firstScriptNode);
                }
            }
        };

        this.serverResponseHandler = function(data, slotDef) {
            var customParams = slotDef.customParams;
            if (data && data['data']) {
                slotDef.data = data['data'];
                slotDef.passbackUrl = data['passback_url'];
                slotDef.subs = data['subs'];

                me.slotsDefs[slotDef.slotId] = slotDef;

                if (slotDef.subs && slotDef.subs.length) {
                    me.initPassbackWorkflow();
                }

                if (customParams && typeof customParams['renderStartCallback'] === 'function') {
                    customParams['renderStartCallback'](slotDef);
                }

                me.adRenderer.renderSlot(me.isSyncMode(), slotDef);
            } else {
                if (customParams && typeof customParams['noContentCallback'] === 'function') {
                    customParams['noContentCallback'](slotDef, data);
                }
            }
        };

        /**
         * Checks, if there are not rendered slots (pushed into window.__ATA.ids array),
         * iterates it and launches displayAd for every item found.
         */
        this.checkNotRendered = function() {
            var slotId, ids, params;
            ids = this.globalPart['ids'];
            // if we're in async mode, then creatives aren't rendered yet.
            if (ids !== null && typeof ids === 'object') {
				params = this && this.globalPart && this.globalPart.customParams || {};
                for (slotId in ids) {
                    if (!ids.hasOwnProperty(slotId)) {
                        continue;
                    }
                    this.displayAd(slotId, params);
                }
            }
        };

        /**
         * Prepares url, which will be used to call ad server for ads.
         * @param {String} baseUrl Without protocol, if possible
         * @returns {String} final url
         */
        this.generateAdServerUrl = function(baseUrl, opts) {
            opts = opts || {};
            var useSSL, url, allParams, baseParams, paramName, paramValue, customParams, lang, referrerUrl;

            useSSL = 'https:' === document.location.protocol;
            allParams = [];
            lang = this.getLang();
            // remove protocol and trailing "?"
            url = baseUrl.replace(/^http:|^https:|\?$/im, '');
            url = (useSSL ? 'https:' : 'http:') + url + opts.type + '/';

            referrerUrl = '';
            if (top !== self) {
                referrerUrl = encodeURIComponent(document.referrer);
            }
            baseParams = [
                'tz=' + new Date().getTimezoneOffset(),
                'fl=' + me.getFlashVersion(),
                'ref=' + referrerUrl || '',
                'pos=' + me.getSlotPosition(opts.slotId) || '',
                'sfv=2'
            ];

            url += opts.sectionId + '/' + opts.width + '/' + opts.height + '/';
            allParams = allParams.concat(baseParams);

            // Add user-defined params to final URL
            me.addCustomParams(me.globalPart.customParams, allParams)
            me.addCustomParams(opts.customParams, allParams)

            if (typeof me.globalPart.click3rd !== 'undefined') {
                allParams.push('click3rd=' + encodeURIComponent(me.globalPart.click3rd));
            }

            if (lang !== false) {
                allParams.push('lang=' + encodeURIComponent(lang));
            }

            return url + '?' + allParams.join('&') + '&ord=' + Math.floor(Math.random() * 10e12);
        };

        this.addCustomParams = function(customParams, allParams) {
            if (typeof customParams !== 'undefined') {
                piterate: for (paramName in customParams) {
                    for (var i = 0, l = knownParams.length; i < l; i++) {
                        if (knownParams[i] + '' === paramName + '') {
                            continue piterate;
                        }
                    }
                    if (customParams.hasOwnProperty(paramName)) {
                        paramValue = customParams[paramName];
                        if (me.isArray(paramValue)) {
                            for (var j = 0; j < paramValue.length; j++) {
                                paramValue[j] = encodeURIComponent(paramValue[j]);
                            }
                            allParams.push(paramName + '=' + paramValue.join('|'));
                            continue piterate;
                        }
                        allParams.push(paramName + '=' + encodeURIComponent(paramValue));
                    }
                }
            }
        };

        /**
         * Returns current sync/async state
         * @returns {Boolean}
         */
        this.isSyncMode = function() {
            return me.globalPart['isSync'] === true;
        };
        this.checkNotRendered();
    }

    /**
     * Instance of this class is connected to AdManager and performs all
     * operations related to ad rendering on page. Usually AdManager calls
     * AdRenderer's instance's renderSlot method with slot id argument.
     * @class AdRenderer
     * @extends AdBase
     * @param {AdManager} adManager
     */
    function AdRenderer(adManager) {
        var me = this;
        /**
         * Link between AdManager and AdRenderer
         * @property {AdManager} adManager
         */
        if (adManager instanceof AdManager) {
            this.adManager = adManager;
        }
        /**
         *
         * @param {Boolean} sync
         * @param {Object} slotDef
         * @param {String} url
         */
        this.renderSlot = function(sync, slotDef) {
            log('<span class="green">Slot rendering method is invoked for ID:: ' + slotDef.slotId + ' ' + 'with ' + slotDef.type + ' content</span>');
            sync ? this.renderSyncSlot(slotDef) : this.renderAsyncSlot(slotDef);
        };
        /**
         * Renders sync slot (page is blocked here now)
         * @param {Object} slot
         * @param {String} url
         * @private
         */
        this.renderSyncSlot = function(slot) {
            if (slot.type === 'adj') {
                document.write('<script type=\"text/javascript\">'+slot.data+'<\/scr' + 'ipt>');
            } else {
                /*document.write(
                    '<iframe src=\"' + url + '\" style=\"border:none;height:' + slot.height + 'px;width:' + slot.width + 'px;\"' +
                    'width=\"' + slot.width + '\" height=\"' + slot.height + '\" border=\"0\"></iframe>'
                );*/
                document.write(slot.data);
            }
        };
        /**
         * Renders ad content.
         * TODO: more detailed description
         * @param {Object} slot slot definition
         * @returns {Boolean} slot render success.
         */
        this.renderAsyncSlot = function(slot) {
            var parentEl, fif, fifWindow, fifDocument, content, syncTagText, isNetscape;
            parentEl = document.getElementById(slot.slotId);
            // ad HTML container is not rendered yet
            if (!parentEl) {
                log('Not ready to render: ' + slot.slotId);
                return false;
            }
            // fif means Friendly iFrame
            fif = me.prepareFrame(slot);
            fif.src = 'javascript:\"<html><body style=\'background:transparent;margin:0%;\'></body></html>\"';
            parentEl.appendChild(fif);

            switch (slot.type) {
                case 'adj':
                    content = '<html><body style=\'background:transparent;margin:0%;\'>' +
                        '<script type=\"text/javascript\">var inDapIF=true;<\/scri' + 'pt>' +
                        '<script type=\"text/javascript\">' + slot.data + '<\/scri' + 'pt>' +
                        '<\/body><\/html>';

                    break;
                case 'adi':
                    //fif.src = url;
                    //parentEl.appendChild(fif);
                    //return true; // nothing  to do more, we've got URL, we've got iframe.
                    content = slot.data;
            }

            // browser-specific flow
            isNetscape = me.isNetscape();

            if (me.getIEVersion() !== 0 || isNetscape) {
                fifWindow = window.frames[fif.name];
                fifWindow['contents'] = content;
                fifWindow.location.replace(me.getFifLocationIE());
            } else {
                fifDocument = fif.contentWindow ? fif.contentWindow.document : fif.contentDocument;

                if (navigator.userAgent.indexOf('Firefox') !== -1) {
                    fifDocument.open('text/html', 'replace');
                }

                fifDocument.write(content);

                // Opera non-webkit won't write all inside scripts if closed
                // this is not good, but important.
                if (!me.isPresto()) {
                    fifDocument.close();
                }
            }
            return true;

        };

        /**
         * Creates basic firendly iframe (fif).
         * @param {Object} slot slot server definition
         * @returns {HTMLElement}
         */
        this.prepareFrame = function(slot) {
            var fif = document.createElement('iframe'),
                fifStyle = 'border:none;',
                fifName = me.getFrameName(slot.slotId);

            // width of iframe
            if (me.notEmptyVar(slot.width)) {
                fifStyle += 'width:' + slot.width + 'px;';
                fif.width = slot.width;
            }

            // height of iframe
            if (me.notEmptyVar(slot.height)) {
                fifStyle += 'height:' + slot.height + 'px;';
                fif.height = slot.height;
            }

            fif.setAttribute('style', fifStyle);
            fif.setAttribute('frameBorder', '0');
            fif.setAttribute('scrolling', 'no');
            fif.name = fifName;
            fif.id = fifName;
            return fif;
        };
        /**
         * Returns correct location for iframe in case of old browser
         * @returns {String}
         */
        this.getFifLocationIE = function() {
            return me.isNetscape() && !me.adManager.isSyncMode() ?
                'javascript:document.write(window.contents);' :
                'javascript:window.contents';
        };
        /**
         * Generates name for Friendly-iFrame ad container
         * @param {String} slotId
         * @returns {String}
         */
        this.getFrameName = function(slotId) {
            return 'fif_slot_' + SLOT_ID_PREFIX + '_' + slotId;
        };

        this.addEvent = function (elem, event, fn, useCapture) {
            if (elem.addEventListener) {
                elem.addEventListener(event, fn, useCapture);
            } else {
                elem.attachEvent("on" + event, function() {
                    return(fn.call(elem, window.event));
                });
            }
        };

    }

    /**
     * Base class for AdRenderer and AdManager, holds some common functions.
     * @class AdBase
     */
    function AdBase() {
        var me = this;

        /**
         * Returns flash version or 0 if none;
         * @returns {Number}
         */
        this.getFlashVersion = function() {
            var flashVersion = 0,
                d;

            if (me.isDefined(navigator.plugins) && typeof navigator.plugins['Shockwave Flash'] === 'object') {
                d = navigator.plugins['Shockwave Flash'].description;
                if (d &&
                    !(me.isDefined(navigator.mimeTypes) &&
                        navigator.mimeTypes['application/x-shockwave-flash'] &&
                        !navigator.mimeTypes['application/x-shockwave-flash'].enabledPlugin)
                ) {
                    d = d.replace(/^.*\s+(\S+\s+\S+$)/, '$1');
                    flashVersion = parseInt(d.replace(/^(.*)\..*$/, '$1'), 10);
                }
            } else if (me.isDefined(window.ActiveXObject)) {
                try {
                    var a = new ActiveXObject('ShockwaveFlash.ShockwaveFlash');
                    if (a) {
                        d = a.GetVariable('$version');
                        if (d) {
                            d = d.split(' ')[1].split(',');
                            flashVersion = parseInt(d[0], 10);
                        }
                    }
                } catch (e) {}
            }

            return flashVersion;
        };

        /**
         * Basic check for typeof !== undefined
         * @param {void} [subject]
         * @returns {Boolean}
         */
        this.isDefined = function(subject) {
            return typeof subject !== 'undefined';
        };

        /**
         * Checks variable for containing any value.
         * TODO: may impl. object/arrays correct processing. Minor.
         * @param {void} variable
         * @returns {Boolean}
         */
        this.notEmptyVar = function(variable) {
            return me.isDefined(variable) &&
                (variable !== null) &&
                (variable + '' !== '');
        };

        /**
         * Returns Internet Explorer version or 0 if not IE.
         * @returns {Number}
         */
        this.getIEVersion = function() {
            var agent = navigator.userAgent,
                isIE = agent.indexOf('MSIE ');
            return -1 === isIE ? 0 : parseFloat(agent.substring(isIE + 5, agent.indexOf(';', isIE)));
        };

        /**
         * Returns true if current browser is suspected to be NN
         * @returns {Boolean}
         */
        this.isNetscape = function() {
            var agent = navigator.userAgent;

            return agent.match(/\d\sNavigator\/\d/) !== null || agent.match(/\d\sNetscape\/\d/) !== null;
        };

        /**
         * Checks if useragent is old Opera. Old Opera is the Opera browser before webkit engine
         * @returns {Boolean}
         */
        this.isPresto = function() {
            return navigator.userAgent.indexOf('Opera') !== -1;
        };

        /**
         * Polyfill from MDN. Checks arg.
         * @param {Mixed} arg
         * @returns {Boolean}
         */
        this.isArray = function(arg) {
            return Object.prototype.toString.call(arg) === '[object Array]';
        };
        /**
         * Returns browser viewport size in (virtual) pixels.
         * @returns {Object} {width: {Number}, height: {Number}}
         */
        this.getScreenSize = function() {
            // Trying to calculate browser window height
            var winHeight = 0,
                winWidth = 0;

            if (typeof window.innerHeight === 'number') {
                // Non-IE
                winHeight = window.innerHeight;
                winWidth = window.innerWidth;
            } else if (document.documentElement && (document.documentElement.clientWidth || document.documentElement.clientHeight)) {
                // IE 6+ in 'standards compliant mode'
                winHeight = document.documentElement.clientHeight;
                winWidth = document.documentElement.clientWidth;
            }
            return {
                width: winWidth,
                height: winHeight
            };
        };
        /**
         * Tries to detect slot position relative to the fold (screen border)
         * @returns {String}
         */
        this.getSlotPosition = function(slotId) {
            // logic is taken from legacy script, but changed a bit, image writing is removed
            // visibility is calculated by the very slot
            // Calculate visibility
            // Trying to calculate pixel's offsetY
            var pix = document.getElementById(slotId);
            var size = me.getScreenSize();
            var pos = pix ? pix.offsetTop : 0;
            while (pix && (pix.offsetParent !== null)) {
                pix = pix.offsetParent;
                pos += pix.offsetTop;
                if (pix.tagName === 'BODY') {
                    break;
                }
            }

            // Compare and save
            if ((pos || (pos === 0)) && size.height) {
                pos > size.height ? pos = 'btf' : pos = 'atf';
            } else {
                pos = '';
            }
            return pos;
        };
        /**
         * Tries to detect page language
         * @returns {String|Boolean}
         */
        this.getLang = function() {
            var metaTags = document.getElementsByTagName('meta'),
                equiv,
                lang = false;

            for (var i = 0; i < metaTags.length; i++) {
                equiv = false;
                if (!!metaTags[i]) {
                    equiv = metaTags[i].getAttribute('http-equiv') || metaTags[i]['httpEquiv'];
                }

                if (!!equiv && equiv.toLowerCase() === 'content-language') {
                    lang = metaTags[i].getAttribute('content') || metaTags[i]['content'];
                    lang = lang || false;
                    return lang;
                }
            }

            return lang;
        };
    }
})();