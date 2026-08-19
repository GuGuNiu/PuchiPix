/*!
 * Vue.js v2.6.10
 * (c) 2014-2019 Evan You
 * Released under the MIT License.
 */
!(function (e, t) {
  "object" == typeof exports && "undefined" != typeof module
    ? (module.exports = t())
    : "function" == typeof define && define.amd
      ? define(t)
      : ((e = e || self).Vue = t());
})(this, function () {
  "use strict";
  var e = Object.freeze({});
  function t(e) {
    return null == e;
  }
  function n(e) {
    return null != e;
  }
  function r(e) {
    return !0 === e;
  }
  function i(e) {
    return "string" == typeof e || "number" == typeof e || "symbol" == typeof e || "boolean" == typeof e;
  }
  function o(e) {
    return null !== e && "object" == typeof e;
  }
  var a = Object.prototype.toString;
  function s(e) {
    return "[object Object]" === a.call(e);
  }
  function c(e) {
    var t = parseFloat(String(e));
    return t >= 0 && Math.floor(t) === t && isFinite(e);
  }
  function u(e) {
    return n(e) && "function" == typeof e.then && "function" == typeof e.catch;
  }
  function l(e) {
    return null == e ? "" : Array.isArray(e) || (s(e) && e.toString === a) ? JSON.stringify(e, null, 2) : String(e);
  }
  function f(e) {
    var t = parseFloat(e);
    return isNaN(t) ? e : t;
  }
  function p(e, t) {
    for (var n = Object.create(null), r = e.split(","), i = 0; i < r.length; i++) n[r[i]] = !0;
    return t
      ? function (e) {
          return n[e.toLowerCase()];
        }
      : function (e) {
          return n[e];
        };
  }
  var d = p("slot,component", !0),
    v = p("key,ref,slot,slot-scope,is");
  function h(e, t) {
    if (e.length) {
      var n = e.indexOf(t);
      if (n > -1) return e.splice(n, 1);
    }
  }
  var m = Object.prototype.hasOwnProperty;
  function y(e, t) {
    return m.call(e, t);
  }
  function g(e) {
    var t = Object.create(null);
    return function (n) {
      return t[n] || (t[n] = e(n));
    };
  }
  var _ = /-(\w)/g,
    b = g(function (e) {
      return e.replace(_, function (e, t) {
        return t ? t.toUpperCase() : "";
      });
    }),
    $ = g(function (e) {
      return e.charAt(0).toUpperCase() + e.slice(1);
    }),
    w = /\B([A-Z])/g,
    C = g(function (e) {
      return e.replace(w, "-$1").toLowerCase();
    });
  var x = Function.prototype.bind
    ? function (e, t) {
        return e.bind(t);
      }
    : function (e, t) {
        function n(n) {
          var r = arguments.length;
          return r ? (r > 1 ? e.apply(t, arguments) : e.call(t, n)) : e.call(t);
        }
        return ((n._length = e.length), n);
      };
  function k(e, t) {
    t = t || 0;
    for (var n = e.length - t, r = new Array(n); n--;) r[n] = e[n + t];
    return r;
  }
  function A(e, t) {
    for (var n in t) e[n] = t[n];
    return e;
  }
  function O(e) {
    for (var t = {}, n = 0; n < e.length; n++) e[n] && A(t, e[n]);
    return t;
  }
  function S(e, t, n) {}
  var T = function (e, t, n) {
      return !1;
    },
    E = function (e) {
      return e;
    };
  function N(e, t) {
    if (e === t) return !0;
    var n = o(e),
      r = o(t);
    if (!n || !r) return !n && !r && String(e) === String(t);
    try {
      var i = Array.isArray(e),
        a = Array.isArray(t);
      if (i && a)
        return (
          e.length === t.length &&
          e.every(function (e, n) {
            return N(e, t[n]);
          })
        );
      if (e instanceof Date && t instanceof Date) return e.getTime() === t.getTime();
      if (i || a) return !1;
      var s = Object.keys(e),
        c = Object.keys(t);
      return (
        s.length === c.length &&
        s.every(function (n) {
          return N(e[n], t[n]);
        })
      );
    } catch (e) {
      return !1;
    }
  }
  function j(e, t) {
    for (var n = 0; n < e.length; n++) if (N(e[n], t)) return n;
    return -1;
  }
  function D(e) {
    var t = !1;
    return function () {
      t || ((t = !0), e.apply(this, arguments));
    };
  }
  var L = "data-server-rendered",
    M = ["component", "directive", "filter"],
    I = [
      "beforeCreate",
      "created",
      "beforeMount",
      "mounted",
      "beforeUpdate",
      "updated",
      "beforeDestroy",
      "destroyed",
      "activated",
      "deactivated",
      "errorCaptured",
      "serverPrefetch",
    ],
    F = {
      optionMergeStrategies: Object.create(null),
      silent: !1,
      productionTip: !1,
      devtools: !1,
      performance: !1,
      errorHandler: null,
      warnHandler: null,
      ignoredElements: [],
      keyCodes: Object.create(null),
      isReservedTag: T,
      isReservedAttr: T,
      isUnknownElement: T,
      getTagNamespace: S,
      parsePlatformTagName: E,
      mustUseProp: T,
      async: !0,
      _lifecycleHooks: I,
    },
    P =
      /a-zA-Z\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD/;
  function R(e, t, n, r) {
    Object.defineProperty(e, t, { value: n, enumerable: !!r, writable: !0, configurable: !0 });
  }
  var H = new RegExp("[^" + P.source + ".$_\\d]");
  var B,
    U = "__proto__" in {},
    z = "undefined" != typeof window,
    V = "undefined" != typeof WXEnvironment && !!WXEnvironment.platform,
    K = V && WXEnvironment.platform.toLowerCase(),
    J = z && window.navigator.userAgent.toLowerCase(),
    q = J && /msie|trident/.test(J),
    W = J && J.indexOf("msie 9.0") > 0,
    Z = J && J.indexOf("edge/") > 0,
    G = (J && J.indexOf("android"), (J && /iphone|ipad|ipod|ios/.test(J)) || "ios" === K),
    X = (J && /chrome\/\d+/.test(J), J && /phantomjs/.test(J), J && J.match(/firefox\/(\d+)/)),
    Y = {}.watch,
    Q = !1;
  if (z)
    try {
      var ee = {};
      (Object.defineProperty(ee, "passive", {
        get: function () {
          Q = !0;
        },
      }),
        window.addEventListener("test-passive", null, ee));
    } catch (e) {}
  var te = function () {
      return (
        void 0 === B &&
          (B = !z && !V && "undefined" != typeof global && global.process && "server" === global.process.env.VUE_ENV),
        B
      );
    },
    ne = z && window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
  function re(e) {
    return "function" == typeof e && /native code/.test(e.toString());
  }
  var ie,
    oe = "undefined" != typeof Symbol && re(Symbol) && "undefined" != typeof Reflect && re(Reflect.ownKeys);
  ie =
    "undefined" != typeof Set && re(Set)
      ? Set
      : (function () {
          function e() {
            this.set = Object.create(null);
          }
          return (
            (e.prototype.has = function (e) {
              return !0 === this.set[e];
            }),
            (e.prototype.add = function (e) {
              this.set[e] = !0;
            }),
            (e.prototype.clear = function () {
              this.set = Object.create(null);
            }),
            e
          );
        })();
  var ae = S,
    se = 0,
    ce = function () {
      ((this.id = se++), (this.subs = []));
    };
  ((ce.prototype.addSub = function (e) {
    this.subs.push(e);
  }),
    (ce.prototype.removeSub = function (e) {
      h(this.subs, e);
    }),
    (ce.prototype.depend = function () {
      ce.target && ce.target.addDep(this);
    }),
    (ce.prototype.notify = function () {
      for (var e = this.subs.slice(), t = 0, n = e.length; t < n; t++) e[t].update();
    }),
    (ce.target = null));
  var ue = [];
  function le(e) {
    (ue.push(e), (ce.target = e));
  }
  function fe() {
    (ue.pop(), (ce.target = ue[ue.length - 1]));
  }
  var pe = function (e, t, n, r, i, o, a, s) {
      ((this.tag = e),
        (this.data = t),
        (this.children = n),
        (this.text = r),
        (this.elm = i),
        (this.ns = void 0),
        (this.context = o),
        (this.fnContext = void 0),
        (this.fnOptions = void 0),
        (this.fnScopeId = void 0),
        (this.key = t && t.key),
        (this.componentOptions = a),
        (this.componentInstance = void 0),
        (this.parent = void 0),
        (this.raw = !1),
        (this.isStatic = !1),
        (this.isRootInsert = !0),
        (this.isComment = !1),
        (this.isCloned = !1),
        (this.isOnce = !1),
        (this.asyncFactory = s),
        (this.asyncMeta = void 0),
        (this.isAsyncPlaceholder = !1));
    },
    de = { child: { configurable: !0 } };
  ((de.child.get = function () {
    return this.componentInstance;
  }),
    Object.defineProperties(pe.prototype, de));
  var ve = function (e) {
    void 0 === e && (e = "");
    var t = new pe();
    return ((t.text = e), (t.isComment = !0), t);
  };
  function he(e) {
    return new pe(void 0, void 0, void 0, String(e));
  }
  function me(e) {
    var t = new pe(
      e.tag,
      e.data,
      e.children && e.children.slice(),
      e.text,
      e.elm,
      e.context,
      e.componentOptions,
      e.asyncFactory,
    );
    return (
      (t.ns = e.ns),
      (t.isStatic = e.isStatic),
      (t.key = e.key),
      (t.isComment = e.isComment),
      (t.fnContext = e.fnContext),
      (t.fnOptions = e.fnOptions),
      (t.fnScopeId = e.fnScopeId),
      (t.asyncMeta = e.asyncMeta),
      (t.isCloned = !0),
      t
    );
  }
  var ye = Array.prototype,
    ge = Object.create(ye);
  ["push", "pop", "shift", "unshift", "splice", "sort", "reverse"].forEach(function (e) {
    var t = ye[e];
    R(ge, e, function () {
      for (var n = [], r = arguments.length; r--;) n[r] = arguments[r];
      var i,
        o = t.apply(this, n),
        a = this.__ob__;
      switch (e) {
        case "push":
        case "unshift":
          i = n;
          break;
        case "splice":
          i = n.slice(2);
      }
      return (i && a.observeArray(i), a.dep.notify(), o);
    });
  });
  var _e = Object.getOwnPropertyNames(ge),
    be = !0;
  function $e(e) {
    be = e;
  }
  var we = function (e) {
    var t;
    ((this.value = e),
      (this.dep = new ce()),
      (this.vmCount = 0),
      R(e, "__ob__", this),
      Array.isArray(e)
        ? (U
            ? ((t = ge), (e.__proto__ = t))
            : (function (e, t, n) {
                for (var r = 0, i = n.length; r < i; r++) {
                  var o = n[r];
                  R(e, o, t[o]);
                }
              })(e, ge, _e),
          this.observeArray(e))
        : this.walk(e));
  };
  function Ce(e, t) {
    var n;
    if (o(e) && !(e instanceof pe))
      return (
        y(e, "__ob__") && e.__ob__ instanceof we
          ? (n = e.__ob__)
          : be && !te() && (Array.isArray(e) || s(e)) && Object.isExtensible(e) && !e._isVue && (n = new we(e)),
        t && n && n.vmCount++,
        n
      );
  }
  function xe(e, t, n, r, i) {
    var o = new ce(),
      a = Object.getOwnPropertyDescriptor(e, t);
    if (!a || !1 !== a.configurable) {
      var s = a && a.get,
        c = a && a.set;
      (s && !c) || 2 !== arguments.length || (n = e[t]);
      var u = !i && Ce(n);
      Object.defineProperty(e, t, {
        enumerable: !0,
        configurable: !0,
        get: function () {
          var t = s ? s.call(e) : n;
          return (
            ce.target &&
              (o.depend(),
              u &&
                (u.dep.depend(),
                Array.isArray(t) &&
                  (function e(t) {
                    for (var n = void 0, r = 0, i = t.length; r < i; r++)
                      ((n = t[r]) && n.__ob__ && n.__ob__.dep.depend(), Array.isArray(n) && e(n));
                  })(t))),
            t
          );
        },
        set: function (t) {
          var r = s ? s.call(e) : n;
          t === r || (t != t && r != r) || (s && !c) || (c ? c.call(e, t) : (n = t), (u = !i && Ce(t)), o.notify());
        },
      });
    }
  }
  function ke(e, t, n) {
    if (Array.isArray(e) && c(t)) return ((e.length = Math.max(e.length, t)), e.splice(t, 1, n), n);
    if (t in e && !(t in Object.prototype)) return ((e[t] = n), n);
    var r = e.__ob__;
    return e._isVue || (r && r.vmCount) ? n : r ? (xe(r.value, t, n), r.dep.notify(), n) : ((e[t] = n), n);
  }
  function Ae(e, t) {
    if (Array.isArray(e) && c(t)) e.splice(t, 1);
    else {
      var n = e.__ob__;
      e._isVue || (n && n.vmCount) || (y(e, t) && (delete e[t], n && n.dep.notify()));
    }
  }
  ((we.prototype.walk = function (e) {
    for (var t = Object.keys(e), n = 0; n < t.length; n++) xe(e, t[n]);
  }),
    (we.prototype.observeArray = function (e) {
      for (var t = 0, n = e.length; t < n; t++) Ce(e[t]);
    }));
  var Oe = F.optionMergeStrategies;
  function Se(e, t) {
    if (!t) return e;
    for (var n, r, i, o = oe ? Reflect.ownKeys(t) : Object.keys(t), a = 0; a < o.length; a++)
      "__ob__" !== (n = o[a]) && ((r = e[n]), (i = t[n]), y(e, n) ? r !== i && s(r) && s(i) && Se(r, i) : ke(e, n, i));
    return e;
  }
  function Te(e, t, n) {
    return n
      ? function () {
          var r = "function" == typeof t ? t.call(n, n) : t,
            i = "function" == typeof e ? e.call(n, n) : e;
          return r ? Se(r, i) : i;
        }
      : t
        ? e
          ? function () {
              return Se(
                "function" == typeof t ? t.call(this, this) : t,
                "function" == typeof e ? e.call(this, this) : e,
              );
            }
          : t
        : e;
  }
  function Ee(e, t) {
    var n = t ? (e ? e.concat(t) : Array.isArray(t) ? t : [t]) : e;
    return n
      ? (function (e) {
          for (var t = [], n = 0; n < e.length; n++) -1 === t.indexOf(e[n]) && t.push(e[n]);
          return t;
        })(n)
      : n;
  }
  function Ne(e, t, n, r) {
    var i = Object.create(e || null);
    return t ? A(i, t) : i;
  }
  ((Oe.data = function (e, t, n) {
    return n ? Te(e, t, n) : t && "function" != typeof t ? e : Te(e, t);
  }),
    I.forEach(function (e) {
      Oe[e] = Ee;
    }),
    M.forEach(function (e) {
      Oe[e + "s"] = Ne;
    }),
    (Oe.watch = function (e, t, n, r) {
      if ((e === Y && (e = void 0), t === Y && (t = void 0), !t)) return Object.create(e || null);
      if (!e) return t;
      var i = {};
      for (var o in (A(i, e), t)) {
        var a = i[o],
          s = t[o];
        (a && !Array.isArray(a) && (a = [a]), (i[o] = a ? a.concat(s) : Array.isArray(s) ? s : [s]));
      }
      return i;
    }),
    (Oe.props =
      Oe.methods =
      Oe.inject =
      Oe.computed =
        function (e, t, n, r) {
          if (!e) return t;
          var i = Object.create(null);
          return (A(i, e), t && A(i, t), i);
        }),
    (Oe.provide = Te));
  var je = function (e, t) {
    return void 0 === t ? e : t;
  };
  function De(e, t, n) {
    if (
      ("function" == typeof t && (t = t.options),
      (function (e, t) {
        var n = e.props;
        if (n) {
          var r,
            i,
            o = {};
          if (Array.isArray(n)) for (r = n.length; r--;) "string" == typeof (i = n[r]) && (o[b(i)] = { type: null });
          else if (s(n)) for (var a in n) ((i = n[a]), (o[b(a)] = s(i) ? i : { type: i }));
          e.props = o;
        }
      })(t),
      (function (e, t) {
        var n = e.inject;
        if (n) {
          var r = (e.inject = {});
          if (Array.isArray(n)) for (var i = 0; i < n.length; i++) r[n[i]] = { from: n[i] };
          else if (s(n))
            for (var o in n) {
              var a = n[o];
              r[o] = s(a) ? A({ from: o }, a) : { from: a };
            }
        }
      })(t),
      (function (e) {
        var t = e.directives;
        if (t)
          for (var n in t) {
            var r = t[n];
            "function" == typeof r && (t[n] = { bind: r, update: r });
          }
      })(t),
      !t._base && (t.extends && (e = De(e, t.extends, n)), t.mixins))
    )
      for (var r = 0, i = t.mixins.length; r < i; r++) e = De(e, t.mixins[r], n);
    var o,
      a = {};
    for (o in e) c(o);
    for (o in t) y(e, o) || c(o);
    function c(r) {
      var i = Oe[r] || je;
      a[r] = i(e[r], t[r], n, r);
    }
    return a;
  }
  function Le(e, t, n, r) {
    if ("string" == typeof n) {
      var i = e[t];
      if (y(i, n)) return i[n];
      var o = b(n);
      if (y(i, o)) return i[o];
      var a = $(o);
      return y(i, a) ? i[a] : i[n] || i[o] || i[a];
    }
  }
  function Me(e, t, n, r) {
    var i = t[e],
      o = !y(n, e),
      a = n[e],
      s = Pe(Boolean, i.type);
    if (s > -1)
      if (o && !y(i, "default")) a = !1;
      else if ("" === a || a === C(e)) {
        var c = Pe(String, i.type);
        (c < 0 || s < c) && (a = !0);
      }
    if (void 0 === a) {
      a = (function (e, t, n) {
        if (!y(t, "default")) return;
        var r = t.default;
        if (e && e.$options.propsData && void 0 === e.$options.propsData[n] && void 0 !== e._props[n])
          return e._props[n];
        return "function" == typeof r && "Function" !== Ie(t.type) ? r.call(e) : r;
      })(r, i, e);
      var u = be;
      ($e(!0), Ce(a), $e(u));
    }
    return a;
  }
  function Ie(e) {
    var t = e && e.toString().match(/^\s*function (\w+)/);
    return t ? t[1] : "";
  }
  function Fe(e, t) {
    return Ie(e) === Ie(t);
  }
  function Pe(e, t) {
    if (!Array.isArray(t)) return Fe(t, e) ? 0 : -1;
    for (var n = 0, r = t.length; n < r; n++) if (Fe(t[n], e)) return n;
    return -1;
  }
  function Re(e, t, n) {
    le();
    try {
      if (t)
        for (var r = t; (r = r.$parent);) {
          var i = r.$options.errorCaptured;
          if (i)
            for (var o = 0; o < i.length; o++)
              try {
                if (!1 === i[o].call(r, e, t, n)) return;
              } catch (e) {
                Be(e, r, "errorCaptured hook");
              }
        }
      Be(e, t, n);
    } finally {
      fe();
    }
  }
  function He(e, t, n, r, i) {
    var o;
    try {
      (o = n ? e.apply(t, n) : e.call(t)) &&
        !o._isVue &&
        u(o) &&
        !o._handled &&
        (o.catch(function (e) {
          return Re(e, r, i + " (Promise/async)");
        }),
        (o._handled = !0));
    } catch (e) {
      Re(e, r, i);
    }
    return o;
  }
  function Be(e, t, n) {
    if (F.errorHandler)
      try {
        return F.errorHandler.call(null, e, t, n);
      } catch (t) {
        t !== e && Ue(t, null, "config.errorHandler");
      }
    Ue(e, t, n);
  }
  function Ue(e, t, n) {
    if ((!z && !V) || "undefined" == typeof console) throw e;
    console.error(e);
  }
  var ze,
    Ve = !1,
    Ke = [],
    Je = !1;
  function qe() {
    Je = !1;
    var e = Ke.slice(0);
    Ke.length = 0;
    for (var t = 0; t < e.length; t++) e[t]();
  }
  if ("undefined" != typeof Promise && re(Promise)) {
    var We = Promise.resolve();
    ((ze = function () {
      (We.then(qe), G && setTimeout(S));
    }),
      (Ve = !0));
  } else if (
    q ||
    "undefined" == typeof MutationObserver ||
    (!re(MutationObserver) && "[object MutationObserverConstructor]" !== MutationObserver.toString())
  )
    ze =
      "undefined" != typeof setImmediate && re(setImmediate)
        ? function () {
            setImmediate(qe);
          }
        : function () {
            setTimeout(qe, 0);
          };
  else {
    var Ze = 1,
      Ge = new MutationObserver(qe),
      Xe = document.createTextNode(String(Ze));
    (Ge.observe(Xe, { characterData: !0 }),
      (ze = function () {
        ((Ze = (Ze + 1) % 2), (Xe.data = String(Ze)));
      }),
      (Ve = !0));
  }
  function Ye(e, t) {
    var n;
    if (
      (Ke.push(function () {
        if (e)
          try {
            e.call(t);
          } catch (e) {
            Re(e, t, "nextTick");
          }
        else n && n(t);
      }),
      Je || ((Je = !0), ze()),
      !e && "undefined" != typeof Promise)
    )
      return new Promise(function (e) {
        n = e;
      });
  }
  var Qe = new ie();
  function et(e) {
    (!(function e(t, n) {
      var r, i;
      var a = Array.isArray(t);
      if ((!a && !o(t)) || Object.isFrozen(t) || t instanceof pe) return;
      if (t.__ob__) {
        var s = t.__ob__.dep.id;
        if (n.has(s)) return;
        n.add(s);
      }
      if (a) for (r = t.length; r--;) e(t[r], n);
      else for (i = Object.keys(t), r = i.length; r--;) e(t[i[r]], n);
    })(e, Qe),
      Qe.clear());
  }
  var tt = g(function (e) {
    var t = "&" === e.charAt(0),
      n = "~" === (e = t ? e.slice(1) : e).charAt(0),
      r = "!" === (e = n ? e.slice(1) : e).charAt(0);
    return { name: (e = r ? e.slice(1) : e), once: n, capture: r, passive: t };
  });
  function nt(e, t) {
    function n() {
      var e = arguments,
        r = n.fns;
      if (!Array.isArray(r)) return He(r, null, arguments, t, "v-on handler");
      for (var i = r.slice(), o = 0; o < i.length; o++) He(i[o], null, e, t, "v-on handler");
    }
    return ((n.fns = e), n);
  }
  function rt(e, n, i, o, a, s) {
    var c, u, l, f;
    for (c in e)
      ((u = e[c]),
        (l = n[c]),
        (f = tt(c)),
        t(u) ||
          (t(l)
            ? (t(u.fns) && (u = e[c] = nt(u, s)),
              r(f.once) && (u = e[c] = a(f.name, u, f.capture)),
              i(f.name, u, f.capture, f.passive, f.params))
            : u !== l && ((l.fns = u), (e[c] = l))));
    for (c in n) t(e[c]) && o((f = tt(c)).name, n[c], f.capture);
  }
  function it(e, i, o) {
    var a;
    e instanceof pe && (e = e.data.hook || (e.data.hook = {}));
    var s = e[i];
    function c() {
      (o.apply(this, arguments), h(a.fns, c));
    }
    (t(s) ? (a = nt([c])) : n(s.fns) && r(s.merged) ? (a = s).fns.push(c) : (a = nt([s, c])),
      (a.merged = !0),
      (e[i] = a));
  }
  function ot(e, t, r, i, o) {
    if (n(t)) {
      if (y(t, r)) return ((e[r] = t[r]), o || delete t[r], !0);
      if (y(t, i)) return ((e[r] = t[i]), o || delete t[i], !0);
    }
    return !1;
  }
  function at(e) {
    return i(e)
      ? [he(e)]
      : Array.isArray(e)
        ? (function e(o, a) {
            var s = [];
            var c, u, l, f;
            for (c = 0; c < o.length; c++)
              t((u = o[c])) ||
                "boolean" == typeof u ||
                ((l = s.length - 1),
                (f = s[l]),
                Array.isArray(u)
                  ? u.length > 0 &&
                    (st((u = e(u, (a || "") + "_" + c))[0]) && st(f) && ((s[l] = he(f.text + u[0].text)), u.shift()),
                    s.push.apply(s, u))
                  : i(u)
                    ? st(f)
                      ? (s[l] = he(f.text + u))
                      : "" !== u && s.push(he(u))
                    : st(u) && st(f)
                      ? (s[l] = he(f.text + u.text))
                      : (r(o._isVList) && n(u.tag) && t(u.key) && n(a) && (u.key = "__vlist" + a + "_" + c + "__"),
                        s.push(u)));
            return s;
          })(e)
        : void 0;
  }
  function st(e) {
    return n(e) && n(e.text) && !1 === e.isComment;
  }
  function ct(e, t) {
    if (e) {
      for (var n = Object.create(null), r = oe ? Reflect.ownKeys(e) : Object.keys(e), i = 0; i < r.length; i++) {
        var o = r[i];
        if ("__ob__" !== o) {
          for (var a = e[o].from, s = t; s;) {
            if (s._provided && y(s._provided, a)) {
              n[o] = s._provided[a];
              break;
            }
            s = s.$parent;
          }
          if (!s && "default" in e[o]) {
            var c = e[o].default;
            n[o] = "function" == typeof c ? c.call(t) : c;
          }
        }
      }
      return n;
    }
  }
  function ut(e, t) {
    if (!e || !e.length) return {};
    for (var n = {}, r = 0, i = e.length; r < i; r++) {
      var o = e[r],
        a = o.data;
      if (
        (a && a.attrs && a.attrs.slot && delete a.attrs.slot,
        (o.context !== t && o.fnContext !== t) || !a || null == a.slot)
      )
        (n.default || (n.default = [])).push(o);
      else {
        var s = a.slot,
          c = n[s] || (n[s] = []);
        "template" === o.tag ? c.push.apply(c, o.children || []) : c.push(o);
      }
    }
    for (var u in n) n[u].every(lt) && delete n[u];
    return n;
  }
  function lt(e) {
    return (e.isComment && !e.asyncFactory) || " " === e.text;
  }
  function ft(t, n, r) {
    var i,
      o = Object.keys(n).length > 0,
      a = t ? !!t.$stable : !o,
      s = t && t.$key;
    if (t) {
      if (t._normalized) return t._normalized;
      if (a && r && r !== e && s === r.$key && !o && !r.$hasNormal) return r;
      for (var c in ((i = {}), t)) t[c] && "$" !== c[0] && (i[c] = pt(n, c, t[c]));
    } else i = {};
    for (var u in n) u in i || (i[u] = dt(n, u));
    return (
      t && Object.isExtensible(t) && (t._normalized = i),
      R(i, "$stable", a),
      R(i, "$key", s),
      R(i, "$hasNormal", o),
      i
    );
  }
  function pt(e, t, n) {
    var r = function () {
      var e = arguments.length ? n.apply(null, arguments) : n({});
      return (e = e && "object" == typeof e && !Array.isArray(e) ? [e] : at(e)) &&
        (0 === e.length || (1 === e.length && e[0].isComment))
        ? void 0
        : e;
    };
    return (n.proxy && Object.defineProperty(e, t, { get: r, enumerable: !0, configurable: !0 }), r);
  }
  function dt(e, t) {
    return function () {
      return e[t];
    };
  }
  function vt(e, t) {
    var r, i, a, s, c;
    if (Array.isArray(e) || "string" == typeof e)
      for (r = new Array(e.length), i = 0, a = e.length; i < a; i++) r[i] = t(e[i], i);
    else if ("number" == typeof e) for (r = new Array(e), i = 0; i < e; i++) r[i] = t(i + 1, i);
    else if (o(e))
      if (oe && e[Symbol.iterator]) {
        r = [];
        for (var u = e[Symbol.iterator](), l = u.next(); !l.done;) (r.push(t(l.value, r.length)), (l = u.next()));
      } else
        for (s = Object.keys(e), r = new Array(s.length), i = 0, a = s.length; i < a; i++)
          ((c = s[i]), (r[i] = t(e[c], c, i)));
    return (n(r) || (r = []), (r._isVList = !0), r);
  }
  function ht(e, t, n, r) {
    var i,
      o = this.$scopedSlots[e];
    o ? ((n = n || {}), r && (n = A(A({}, r), n)), (i = o(n) || t)) : (i = this.$slots[e] || t);
    var a = n && n.slot;
    return a ? this.$createElement("template", { slot: a }, i) : i;
  }
  function mt(e) {
    return Le(this.$options, "filters", e) || E;
  }
  function yt(e, t) {
    return Array.isArray(e) ? -1 === e.indexOf(t) : e !== t;
  }
  function gt(e, t, n, r, i) {
    var o = F.keyCodes[t] || n;
    return i && r && !F.keyCodes[t] ? yt(i, r) : o ? yt(o, e) : r ? C(r) !== t : void 0;
  }
  function _t(e, t, n, r, i) {
    if (n)
      if (o(n)) {
        var a;
        Array.isArray(n) && (n = O(n));
        var s = function (o) {
          if ("class" === o || "style" === o || v(o)) a = e;
          else {
            var s = e.attrs && e.attrs.type;
            a = r || F.mustUseProp(t, s, o) ? e.domProps || (e.domProps = {}) : e.attrs || (e.attrs = {});
          }
          var c = b(o),
            u = C(o);
          c in a ||
            u in a ||
            ((a[o] = n[o]),
            i &&
              ((e.on || (e.on = {}))["update:" + o] = function (e) {
                n[o] = e;
              }));
        };
        for (var c in n) s(c);
      } else;
    return e;
  }
  function bt(e, t) {
    var n = this._staticTrees || (this._staticTrees = []),
      r = n[e];
    return r && !t
      ? r
      : (wt((r = n[e] = this.$options.staticRenderFns[e].call(this._renderProxy, null, this)), "__static__" + e, !1),
        r);
  }
  function $t(e, t, n) {
    return (wt(e, "__once__" + t + (n ? "_" + n : ""), !0), e);
  }
  function wt(e, t, n) {
    if (Array.isArray(e))
      for (var r = 0; r < e.length; r++) e[r] && "string" != typeof e[r] && Ct(e[r], t + "_" + r, n);
    else Ct(e, t, n);
  }
  function Ct(e, t, n) {
    ((e.isStatic = !0), (e.key = t), (e.isOnce = n));
  }
  function xt(e, t) {
    if (t)
      if (s(t)) {
        var n = (e.on = e.on ? A({}, e.on) : {});
        for (var r in t) {
          var i = n[r],
            o = t[r];
          n[r] = i ? [].concat(i, o) : o;
        }
      } else;
    return e;
  }
  function kt(e, t, n, r) {
    t = t || { $stable: !n };
    for (var i = 0; i < e.length; i++) {
      var o = e[i];
      Array.isArray(o) ? kt(o, t, n) : o && (o.proxy && (o.fn.proxy = !0), (t[o.key] = o.fn));
    }
    return (r && (t.$key = r), t);
  }
  function At(e, t) {
    for (var n = 0; n < t.length; n += 2) {
      var r = t[n];
      "string" == typeof r && r && (e[t[n]] = t[n + 1]);
    }
    return e;
  }
  function Ot(e, t) {
    return "string" == typeof e ? t + e : e;
  }
  function St(e) {
    ((e._o = $t),
      (e._n = f),
      (e._s = l),
      (e._l = vt),
      (e._t = ht),
      (e._q = N),
      (e._i = j),
      (e._m = bt),
      (e._f = mt),
      (e._k = gt),
      (e._b = _t),
      (e._v = he),
      (e._e = ve),
      (e._u = kt),
      (e._g = xt),
      (e._d = At),
      (e._p = Ot));
  }
  function Tt(t, n, i, o, a) {
    var s,
      c = this,
      u = a.options;
    y(o, "_uid") ? ((s = Object.create(o))._original = o) : ((s = o), (o = o._original));
    var l = r(u._compiled),
      f = !l;
    ((this.data = t),
      (this.props = n),
      (this.children = i),
      (this.parent = o),
      (this.listeners = t.on || e),
      (this.injections = ct(u.inject, o)),
      (this.slots = function () {
        return (c.$slots || ft(t.scopedSlots, (c.$slots = ut(i, o))), c.$slots);
      }),
      Object.defineProperty(this, "scopedSlots", {
        enumerable: !0,
        get: function () {
          return ft(t.scopedSlots, this.slots());
        },
      }),
      l && ((this.$options = u), (this.$slots = this.slots()), (this.$scopedSlots = ft(t.scopedSlots, this.$slots))),
      u._scopeId
        ? (this._c = function (e, t, n, r) {
            var i = Pt(s, e, t, n, r, f);
            return (i && !Array.isArray(i) && ((i.fnScopeId = u._scopeId), (i.fnContext = o)), i);
          })
        : (this._c = function (e, t, n, r) {
            return Pt(s, e, t, n, r, f);
          }));
  }
  function Et(e, t, n, r, i) {
    var o = me(e);
    return ((o.fnContext = n), (o.fnOptions = r), t.slot && ((o.data || (o.data = {})).slot = t.slot), o);
  }
  function Nt(e, t) {
    for (var n in t) e[b(n)] = t[n];
  }
  St(Tt.prototype);
  var jt = {
      init: function (e, t) {
        if (e.componentInstance && !e.componentInstance._isDestroyed && e.data.keepAlive) {
          var r = e;
          jt.prepatch(r, r);
        } else {
          (e.componentInstance = (function (e, t) {
            var r = { _isComponent: !0, _parentVnode: e, parent: t },
              i = e.data.inlineTemplate;
            n(i) && ((r.render = i.render), (r.staticRenderFns = i.staticRenderFns));
            return new e.componentOptions.Ctor(r);
          })(e, Wt)).$mount(t ? e.elm : void 0, t);
        }
      },
      prepatch: function (t, n) {
        var r = n.componentOptions;
        !(function (t, n, r, i, o) {
          var a = i.data.scopedSlots,
            s = t.$scopedSlots,
            c = !!((a && !a.$stable) || (s !== e && !s.$stable) || (a && t.$scopedSlots.$key !== a.$key)),
            u = !!(o || t.$options._renderChildren || c);
          ((t.$options._parentVnode = i), (t.$vnode = i), t._vnode && (t._vnode.parent = i));
          if (
            ((t.$options._renderChildren = o),
            (t.$attrs = i.data.attrs || e),
            (t.$listeners = r || e),
            n && t.$options.props)
          ) {
            $e(!1);
            for (var l = t._props, f = t.$options._propKeys || [], p = 0; p < f.length; p++) {
              var d = f[p],
                v = t.$options.props;
              l[d] = Me(d, v, n, t);
            }
            ($e(!0), (t.$options.propsData = n));
          }
          r = r || e;
          var h = t.$options._parentListeners;
          ((t.$options._parentListeners = r), qt(t, r, h), u && ((t.$slots = ut(o, i.context)), t.$forceUpdate()));
        })((n.componentInstance = t.componentInstance), r.propsData, r.listeners, n, r.children);
      },
      insert: function (e) {
        var t,
          n = e.context,
          r = e.componentInstance;
        (r._isMounted || ((r._isMounted = !0), Yt(r, "mounted")),
          e.data.keepAlive && (n._isMounted ? (((t = r)._inactive = !1), en.push(t)) : Xt(r, !0)));
      },
      destroy: function (e) {
        var t = e.componentInstance;
        t._isDestroyed ||
          (e.data.keepAlive
            ? (function e(t, n) {
                if (n && ((t._directInactive = !0), Gt(t))) return;
                if (!t._inactive) {
                  t._inactive = !0;
                  for (var r = 0; r < t.$children.length; r++) e(t.$children[r]);
                  Yt(t, "deactivated");
                }
              })(t, !0)
            : t.$destroy());
      },
    },
    Dt = Object.keys(jt);
  function Lt(i, a, s, c, l) {
    if (!t(i)) {
      var f = s.$options._base;
      if ((o(i) && (i = f.extend(i)), "function" == typeof i)) {
        var p;
        if (
          t(i.cid) &&
          void 0 ===
            (i = (function (e, i) {
              if (r(e.error) && n(e.errorComp)) return e.errorComp;
              if (n(e.resolved)) return e.resolved;
              var a = Ht;
              a && n(e.owners) && -1 === e.owners.indexOf(a) && e.owners.push(a);
              if (r(e.loading) && n(e.loadingComp)) return e.loadingComp;
              if (a && !n(e.owners)) {
                var s = (e.owners = [a]),
                  c = !0,
                  l = null,
                  f = null;
                a.$on("hook:destroyed", function () {
                  return h(s, a);
                });
                var p = function (e) {
                    for (var t = 0, n = s.length; t < n; t++) s[t].$forceUpdate();
                    e &&
                      ((s.length = 0),
                      null !== l && (clearTimeout(l), (l = null)),
                      null !== f && (clearTimeout(f), (f = null)));
                  },
                  d = D(function (t) {
                    ((e.resolved = Bt(t, i)), c ? (s.length = 0) : p(!0));
                  }),
                  v = D(function (t) {
                    n(e.errorComp) && ((e.error = !0), p(!0));
                  }),
                  m = e(d, v);
                return (
                  o(m) &&
                    (u(m)
                      ? t(e.resolved) && m.then(d, v)
                      : u(m.component) &&
                        (m.component.then(d, v),
                        n(m.error) && (e.errorComp = Bt(m.error, i)),
                        n(m.loading) &&
                          ((e.loadingComp = Bt(m.loading, i)),
                          0 === m.delay
                            ? (e.loading = !0)
                            : (l = setTimeout(function () {
                                ((l = null), t(e.resolved) && t(e.error) && ((e.loading = !0), p(!1)));
                              }, m.delay || 200))),
                        n(m.timeout) &&
                          (f = setTimeout(function () {
                            ((f = null), t(e.resolved) && v(null));
                          }, m.timeout)))),
                  (c = !1),
                  e.loading ? e.loadingComp : e.resolved
                );
              }
            })((p = i), f))
        )
          return (function (e, t, n, r, i) {
            var o = ve();
            return ((o.asyncFactory = e), (o.asyncMeta = { data: t, context: n, children: r, tag: i }), o);
          })(p, a, s, c, l);
        ((a = a || {}),
          $n(i),
          n(a.model) &&
            (function (e, t) {
              var r = (e.model && e.model.prop) || "value",
                i = (e.model && e.model.event) || "input";
              (t.attrs || (t.attrs = {}))[r] = t.model.value;
              var o = t.on || (t.on = {}),
                a = o[i],
                s = t.model.callback;
              n(a) ? (Array.isArray(a) ? -1 === a.indexOf(s) : a !== s) && (o[i] = [s].concat(a)) : (o[i] = s);
            })(i.options, a));
        var d = (function (e, r, i) {
          var o = r.options.props;
          if (!t(o)) {
            var a = {},
              s = e.attrs,
              c = e.props;
            if (n(s) || n(c))
              for (var u in o) {
                var l = C(u);
                ot(a, c, u, l, !0) || ot(a, s, u, l, !1);
              }
            return a;
          }
        })(a, i);
        if (r(i.options.functional))
          return (function (t, r, i, o, a) {
            var s = t.options,
              c = {},
              u = s.props;
            if (n(u)) for (var l in u) c[l] = Me(l, u, r || e);
            else (n(i.attrs) && Nt(c, i.attrs), n(i.props) && Nt(c, i.props));
            var f = new Tt(i, c, a, o, t),
              p = s.render.call(null, f._c, f);
            if (p instanceof pe) return Et(p, i, f.parent, s);
            if (Array.isArray(p)) {
              for (var d = at(p) || [], v = new Array(d.length), h = 0; h < d.length; h++)
                v[h] = Et(d[h], i, f.parent, s);
              return v;
            }
          })(i, d, a, s, c);
        var v = a.on;
        if (((a.on = a.nativeOn), r(i.options.abstract))) {
          var m = a.slot;
          ((a = {}), m && (a.slot = m));
        }
        !(function (e) {
          for (var t = e.hook || (e.hook = {}), n = 0; n < Dt.length; n++) {
            var r = Dt[n],
              i = t[r],
              o = jt[r];
            i === o || (i && i._merged) || (t[r] = i ? Mt(o, i) : o);
          }
        })(a);
        var y = i.options.name || l;
        return new pe(
          "vue-component-" + i.cid + (y ? "-" + y : ""),
          a,
          void 0,
          void 0,
          void 0,
          s,
          { Ctor: i, propsData: d, listeners: v, tag: l, children: c },
          p,
        );
      }
    }
  }
  function Mt(e, t) {
    var n = function (n, r) {
      (e(n, r), t(n, r));
    };
    return ((n._merged = !0), n);
  }
  var It = 1,
    Ft = 2;
  function Pt(e, a, s, c, u, l) {
    return (
      (Array.isArray(s) || i(s)) && ((u = c), (c = s), (s = void 0)),
      r(l) && (u = Ft),
      (function (e, i, a, s, c) {
        if (n(a) && n(a.__ob__)) return ve();
        n(a) && n(a.is) && (i = a.is);
        if (!i) return ve();
        Array.isArray(s) &&
          "function" == typeof s[0] &&
          (((a = a || {}).scopedSlots = { default: s[0] }), (s.length = 0));
        c === Ft
          ? (s = at(s))
          : c === It &&
            (s = (function (e) {
              for (var t = 0; t < e.length; t++) if (Array.isArray(e[t])) return Array.prototype.concat.apply([], e);
              return e;
            })(s));
        var u, l;
        if ("string" == typeof i) {
          var f;
          ((l = (e.$vnode && e.$vnode.ns) || F.getTagNamespace(i)),
            (u = F.isReservedTag(i)
              ? new pe(F.parsePlatformTagName(i), a, s, void 0, void 0, e)
              : (a && a.pre) || !n((f = Le(e.$options, "components", i)))
                ? new pe(i, a, s, void 0, void 0, e)
                : Lt(f, a, e, s, i)));
        } else u = Lt(i, a, e, s);
        return Array.isArray(u)
          ? u
          : n(u)
            ? (n(l) &&
                (function e(i, o, a) {
                  i.ns = o;
                  "foreignObject" === i.tag && ((o = void 0), (a = !0));
                  if (n(i.children))
                    for (var s = 0, c = i.children.length; s < c; s++) {
                      var u = i.children[s];
                      n(u.tag) && (t(u.ns) || (r(a) && "svg" !== u.tag)) && e(u, o, a);
                    }
                })(u, l),
              n(a) &&
                (function (e) {
                  o(e.style) && et(e.style);
                  o(e.class) && et(e.class);
                })(a),
              u)
            : ve();
      })(e, a, s, c, u)
    );
  }
  var Rt,
    Ht = null;
  function Bt(e, t) {
    return ((e.__sModule || (oe && "Module" === e[Symbol.toStringTag])) && (e = e.default), o(e) ? t.extend(e) : e);
  }
  function Ut(e) {
    return e.isComment && e.asyncFactory;
  }
  function zt(e) {
    if (Array.isArray(e))
      for (var t = 0; t < e.length; t++) {
        var r = e[t];
        if (n(r) && (n(r.componentOptions) || Ut(r))) return r;
      }
  }
  function Vt(e, t) {
    Rt.$on(e, t);
  }
  function Kt(e, t) {
    Rt.$off(e, t);
  }
  function Jt(e, t) {
    var n = Rt;
    return function r() {
      null !== t.apply(null, arguments) && n.$off(e, r);
    };
  }
  function qt(e, t, n) {
    ((Rt = e), rt(t, n || {}, Vt, Kt, Jt, e), (Rt = void 0));
  }
  var Wt = null;
  function Zt(e) {
    var t = Wt;
    return (
      (Wt = e),
      function () {
        Wt = t;
      }
    );
  }
  function Gt(e) {
    for (; e && (e = e.$parent);) if (e._inactive) return !0;
    return !1;
  }
  function Xt(e, t) {
    if (t) {
      if (((e._directInactive = !1), Gt(e))) return;
    } else if (e._directInactive) return;
    if (e._inactive || null === e._inactive) {
      e._inactive = !1;
      for (var n = 0; n < e.$children.length; n++) Xt(e.$children[n]);
      Yt(e, "activated");
    }
  }
  function Yt(e, t) {
    le();
    var n = e.$options[t],
      r = t + " hook";
    if (n) for (var i = 0, o = n.length; i < o; i++) He(n[i], e, null, e, r);
    (e._hasHookEvent && e.$emit("hook:" + t), fe());
  }
  var Qt = [],
    en = [],
    tn = {},
    nn = !1,
    rn = !1,
    on = 0;
  var an = 0,
    sn = Date.now;
  if (z && !q) {
    var cn = window.performance;
    cn &&
      "function" == typeof cn.now &&
      sn() > document.createEvent("Event").timeStamp &&
      (sn = function () {
        return cn.now();
      });
  }
  function un() {
    var e, t;
    for (
      an = sn(),
        rn = !0,
        Qt.sort(function (e, t) {
          return e.id - t.id;
        }),
        on = 0;
      on < Qt.length;
      on++
    )
      ((e = Qt[on]).before && e.before(), (t = e.id), (tn[t] = null), e.run());
    var n = en.slice(),
      r = Qt.slice();
    ((on = Qt.length = en.length = 0),
      (tn = {}),
      (nn = rn = !1),
      (function (e) {
        for (var t = 0; t < e.length; t++) ((e[t]._inactive = !0), Xt(e[t], !0));
      })(n),
      (function (e) {
        var t = e.length;
        for (; t--;) {
          var n = e[t],
            r = n.vm;
          r._watcher === n && r._isMounted && !r._isDestroyed && Yt(r, "updated");
        }
      })(r),
      ne && F.devtools && ne.emit("flush"));
  }
  var ln = 0,
    fn = function (e, t, n, r, i) {
      ((this.vm = e),
        i && (e._watcher = this),
        e._watchers.push(this),
        r
          ? ((this.deep = !!r.deep),
            (this.user = !!r.user),
            (this.lazy = !!r.lazy),
            (this.sync = !!r.sync),
            (this.before = r.before))
          : (this.deep = this.user = this.lazy = this.sync = !1),
        (this.cb = n),
        (this.id = ++ln),
        (this.active = !0),
        (this.dirty = this.lazy),
        (this.deps = []),
        (this.newDeps = []),
        (this.depIds = new ie()),
        (this.newDepIds = new ie()),
        (this.expression = ""),
        "function" == typeof t
          ? (this.getter = t)
          : ((this.getter = (function (e) {
              if (!H.test(e)) {
                var t = e.split(".");
                return function (e) {
                  for (var n = 0; n < t.length; n++) {
                    if (!e) return;
                    e = e[t[n]];
                  }
                  return e;
                };
              }
            })(t)),
            this.getter || (this.getter = S)),
        (this.value = this.lazy ? void 0 : this.get()));
    };
  ((fn.prototype.get = function () {
    var e;
    le(this);
    var t = this.vm;
    try {
      e = this.getter.call(t, t);
    } catch (e) {
      if (!this.user) throw e;
      Re(e, t, 'getter for watcher "' + this.expression + '"');
    } finally {
      (this.deep && et(e), fe(), this.cleanupDeps());
    }
    return e;
  }),
    (fn.prototype.addDep = function (e) {
      var t = e.id;
      this.newDepIds.has(t) || (this.newDepIds.add(t), this.newDeps.push(e), this.depIds.has(t) || e.addSub(this));
    }),
    (fn.prototype.cleanupDeps = function () {
      for (var e = this.deps.length; e--;) {
        var t = this.deps[e];
        this.newDepIds.has(t.id) || t.removeSub(this);
      }
      var n = this.depIds;
      ((this.depIds = this.newDepIds),
        (this.newDepIds = n),
        this.newDepIds.clear(),
        (n = this.deps),
        (this.deps = this.newDeps),
        (this.newDeps = n),
        (this.newDeps.length = 0));
    }),
    (fn.prototype.update = function () {
      this.lazy
        ? (this.dirty = !0)
        : this.sync
          ? this.run()
          : (function (e) {
              var t = e.id;
              if (null == tn[t]) {
                if (((tn[t] = !0), rn)) {
                  for (var n = Qt.length - 1; n > on && Qt[n].id > e.id;) n--;
                  Qt.splice(n + 1, 0, e);
                } else Qt.push(e);
                nn || ((nn = !0), Ye(un));
              }
            })(this);
    }),
    (fn.prototype.run = function () {
      if (this.active) {
        var e = this.get();
        if (e !== this.value || o(e) || this.deep) {
          var t = this.value;
          if (((this.value = e), this.user))
            try {
              this.cb.call(this.vm, e, t);
            } catch (e) {
              Re(e, this.vm, 'callback for watcher "' + this.expression + '"');
            }
          else this.cb.call(this.vm, e, t);
        }
      }
    }),
    (fn.prototype.evaluate = function () {
      ((this.value = this.get()), (this.dirty = !1));
    }),
    (fn.prototype.depend = function () {
      for (var e = this.deps.length; e--;) this.deps[e].depend();
    }),
    (fn.prototype.teardown = function () {
      if (this.active) {
        this.vm._isBeingDestroyed || h(this.vm._watchers, this);
        for (var e = this.deps.length; e--;) this.deps[e].removeSub(this);
        this.active = !1;
      }
    }));
  var pn = { enumerable: !0, configurable: !0, get: S, set: S };
  function dn(e, t, n) {
    ((pn.get = function () {
      return this[t][n];
    }),
      (pn.set = function (e) {
        this[t][n] = e;
      }),
      Object.defineProperty(e, n, pn));
  }
  function vn(e) {
    e._watchers = [];
    var t = e.$options;
    (t.props &&
      (function (e, t) {
        var n = e.$options.propsData || {},
          r = (e._props = {}),
          i = (e.$options._propKeys = []);
        e.$parent && $e(!1);
        var o = function (o) {
          i.push(o);
          var a = Me(o, t, n, e);
          (xe(r, o, a), o in e || dn(e, "_props", o));
        };
        for (var a in t) o(a);
        $e(!0);
      })(e, t.props),
      t.methods &&
        (function (e, t) {
          e.$options.props;
          for (var n in t) e[n] = "function" != typeof t[n] ? S : x(t[n], e);
        })(e, t.methods),
      t.data
        ? (function (e) {
            var t = e.$options.data;
            s(
              (t = e._data =
                "function" == typeof t
                  ? (function (e, t) {
                      le();
                      try {
                        return e.call(t, t);
                      } catch (e) {
                        return (Re(e, t, "data()"), {});
                      } finally {
                        fe();
                      }
                    })(t, e)
                  : t || {}),
            ) || (t = {});
            var n = Object.keys(t),
              r = e.$options.props,
              i = (e.$options.methods, n.length);
            for (; i--;) {
              var o = n[i];
              (r && y(r, o)) || ((a = void 0), 36 !== (a = (o + "").charCodeAt(0)) && 95 !== a && dn(e, "_data", o));
            }
            var a;
            Ce(t, !0);
          })(e)
        : Ce((e._data = {}), !0),
      t.computed &&
        (function (e, t) {
          var n = (e._computedWatchers = Object.create(null)),
            r = te();
          for (var i in t) {
            var o = t[i],
              a = "function" == typeof o ? o : o.get;
            (r || (n[i] = new fn(e, a || S, S, hn)), i in e || mn(e, i, o));
          }
        })(e, t.computed),
      t.watch &&
        t.watch !== Y &&
        (function (e, t) {
          for (var n in t) {
            var r = t[n];
            if (Array.isArray(r)) for (var i = 0; i < r.length; i++) _n(e, n, r[i]);
            else _n(e, n, r);
          }
        })(e, t.watch));
  }
  var hn = { lazy: !0 };
  function mn(e, t, n) {
    var r = !te();
    ("function" == typeof n
      ? ((pn.get = r ? yn(t) : gn(n)), (pn.set = S))
      : ((pn.get = n.get ? (r && !1 !== n.cache ? yn(t) : gn(n.get)) : S), (pn.set = n.set || S)),
      Object.defineProperty(e, t, pn));
  }
  function yn(e) {
    return function () {
      var t = this._computedWatchers && this._computedWatchers[e];
      if (t) return (t.dirty && t.evaluate(), ce.target && t.depend(), t.value);
    };
  }
  function gn(e) {
    return function () {
      return e.call(this, this);
    };
  }
  function _n(e, t, n, r) {
    return (s(n) && ((r = n), (n = n.handler)), "string" == typeof n && (n = e[n]), e.$watch(t, n, r));
  }
  var bn = 0;
  function $n(e) {
    var t = e.options;
    if (e.super) {
      var n = $n(e.super);
      if (n !== e.superOptions) {
        e.superOptions = n;
        var r = (function (e) {
          var t,
            n = e.options,
            r = e.sealedOptions;
          for (var i in n) n[i] !== r[i] && (t || (t = {}), (t[i] = n[i]));
          return t;
        })(e);
        (r && A(e.extendOptions, r), (t = e.options = De(n, e.extendOptions)).name && (t.components[t.name] = e));
      }
    }
    return t;
  }
  function wn(e) {
    this._init(e);
  }
  function Cn(e) {
    e.cid = 0;
    var t = 1;
    e.extend = function (e) {
      e = e || {};
      var n = this,
        r = n.cid,
        i = e._Ctor || (e._Ctor = {});
      if (i[r]) return i[r];
      var o = e.name || n.options.name,
        a = function (e) {
          this._init(e);
        };
      return (
        ((a.prototype = Object.create(n.prototype)).constructor = a),
        (a.cid = t++),
        (a.options = De(n.options, e)),
        (a.super = n),
        a.options.props &&
          (function (e) {
            var t = e.options.props;
            for (var n in t) dn(e.prototype, "_props", n);
          })(a),
        a.options.computed &&
          (function (e) {
            var t = e.options.computed;
            for (var n in t) mn(e.prototype, n, t[n]);
          })(a),
        (a.extend = n.extend),
        (a.mixin = n.mixin),
        (a.use = n.use),
        M.forEach(function (e) {
          a[e] = n[e];
        }),
        o && (a.options.components[o] = a),
        (a.superOptions = n.options),
        (a.extendOptions = e),
        (a.sealedOptions = A({}, a.options)),
        (i[r] = a),
        a
      );
    };
  }
  function xn(e) {
    return e && (e.Ctor.options.name || e.tag);
  }
  function kn(e, t) {
    return Array.isArray(e)
      ? e.indexOf(t) > -1
      : "string" == typeof e
        ? e.split(",").indexOf(t) > -1
        : ((n = e), "[object RegExp]" === a.call(n) && e.test(t));
    var n;
  }
  function An(e, t) {
    var n = e.cache,
      r = e.keys,
      i = e._vnode;
    for (var o in n) {
      var a = n[o];
      if (a) {
        var s = xn(a.componentOptions);
        s && !t(s) && On(n, o, r, i);
      }
    }
  }
  function On(e, t, n, r) {
    var i = e[t];
    (!i || (r && i.tag === r.tag) || i.componentInstance.$destroy(), (e[t] = null), h(n, t));
  }
  (!(function (t) {
    t.prototype._init = function (t) {
      var n = this;
      ((n._uid = bn++),
        (n._isVue = !0),
        t && t._isComponent
          ? (function (e, t) {
              var n = (e.$options = Object.create(e.constructor.options)),
                r = t._parentVnode;
              ((n.parent = t.parent), (n._parentVnode = r));
              var i = r.componentOptions;
              ((n.propsData = i.propsData),
                (n._parentListeners = i.listeners),
                (n._renderChildren = i.children),
                (n._componentTag = i.tag),
                t.render && ((n.render = t.render), (n.staticRenderFns = t.staticRenderFns)));
            })(n, t)
          : (n.$options = De($n(n.constructor), t || {}, n)),
        (n._renderProxy = n),
        (n._self = n),
        (function (e) {
          var t = e.$options,
            n = t.parent;
          if (n && !t.abstract) {
            for (; n.$options.abstract && n.$parent;) n = n.$parent;
            n.$children.push(e);
          }
          ((e.$parent = n),
            (e.$root = n ? n.$root : e),
            (e.$children = []),
            (e.$refs = {}),
            (e._watcher = null),
            (e._inactive = null),
            (e._directInactive = !1),
            (e._isMounted = !1),
            (e._isDestroyed = !1),
            (e._isBeingDestroyed = !1));
        })(n),
        (function (e) {
          ((e._events = Object.create(null)), (e._hasHookEvent = !1));
          var t = e.$options._parentListeners;
          t && qt(e, t);
        })(n),
        (function (t) {
          ((t._vnode = null), (t._staticTrees = null));
          var n = t.$options,
            r = (t.$vnode = n._parentVnode),
            i = r && r.context;
          ((t.$slots = ut(n._renderChildren, i)),
            (t.$scopedSlots = e),
            (t._c = function (e, n, r, i) {
              return Pt(t, e, n, r, i, !1);
            }),
            (t.$createElement = function (e, n, r, i) {
              return Pt(t, e, n, r, i, !0);
            }));
          var o = r && r.data;
          (xe(t, "$attrs", (o && o.attrs) || e, null, !0), xe(t, "$listeners", n._parentListeners || e, null, !0));
        })(n),
        Yt(n, "beforeCreate"),
        (function (e) {
          var t = ct(e.$options.inject, e);
          t &&
            ($e(!1),
            Object.keys(t).forEach(function (n) {
              xe(e, n, t[n]);
            }),
            $e(!0));
        })(n),
        vn(n),
        (function (e) {
          var t = e.$options.provide;
          t && (e._provided = "function" == typeof t ? t.call(e) : t);
        })(n),
        Yt(n, "created"),
        n.$options.el && n.$mount(n.$options.el));
    };
  })(wn),
    (function (e) {
      var t = {
          get: function () {
            return this._data;
          },
        },
        n = {
          get: function () {
            return this._props;
          },
        };
      (Object.defineProperty(e.prototype, "$data", t),
        Object.defineProperty(e.prototype, "$props", n),
        (e.prototype.$set = ke),
        (e.prototype.$delete = Ae),
        (e.prototype.$watch = function (e, t, n) {
          if (s(t)) return _n(this, e, t, n);
          (n = n || {}).user = !0;
          var r = new fn(this, e, t, n);
          if (n.immediate)
            try {
              t.call(this, r.value);
            } catch (e) {
              Re(e, this, 'callback for immediate watcher "' + r.expression + '"');
            }
          return function () {
            r.teardown();
          };
        }));
    })(wn),
    (function (e) {
      var t = /^hook:/;
      ((e.prototype.$on = function (e, n) {
        var r = this;
        if (Array.isArray(e)) for (var i = 0, o = e.length; i < o; i++) r.$on(e[i], n);
        else ((r._events[e] || (r._events[e] = [])).push(n), t.test(e) && (r._hasHookEvent = !0));
        return r;
      }),
        (e.prototype.$once = function (e, t) {
          var n = this;
          function r() {
            (n.$off(e, r), t.apply(n, arguments));
          }
          return ((r.fn = t), n.$on(e, r), n);
        }),
        (e.prototype.$off = function (e, t) {
          var n = this;
          if (!arguments.length) return ((n._events = Object.create(null)), n);
          if (Array.isArray(e)) {
            for (var r = 0, i = e.length; r < i; r++) n.$off(e[r], t);
            return n;
          }
          var o,
            a = n._events[e];
          if (!a) return n;
          if (!t) return ((n._events[e] = null), n);
          for (var s = a.length; s--;)
            if ((o = a[s]) === t || o.fn === t) {
              a.splice(s, 1);
              break;
            }
          return n;
        }),
        (e.prototype.$emit = function (e) {
          var t = this._events[e];
          if (t) {
            t = t.length > 1 ? k(t) : t;
            for (var n = k(arguments, 1), r = 'event handler for "' + e + '"', i = 0, o = t.length; i < o; i++)
              He(t[i], this, n, this, r);
          }
          return this;
        }));
    })(wn),
    (function (e) {
      ((e.prototype._update = function (e, t) {
        var n = this,
          r = n.$el,
          i = n._vnode,
          o = Zt(n);
        ((n._vnode = e),
          (n.$el = i ? n.__patch__(i, e) : n.__patch__(n.$el, e, t, !1)),
          o(),
          r && (r.__vue__ = null),
          n.$el && (n.$el.__vue__ = n),
          n.$vnode && n.$parent && n.$vnode === n.$parent._vnode && (n.$parent.$el = n.$el));
      }),
        (e.prototype.$forceUpdate = function () {
          this._watcher && this._watcher.update();
        }),
        (e.prototype.$destroy = function () {
          var e = this;
          if (!e._isBeingDestroyed) {
            (Yt(e, "beforeDestroy"), (e._isBeingDestroyed = !0));
            var t = e.$parent;
            (!t || t._isBeingDestroyed || e.$options.abstract || h(t.$children, e),
              e._watcher && e._watcher.teardown());
            for (var n = e._watchers.length; n--;) e._watchers[n].teardown();
            (e._data.__ob__ && e._data.__ob__.vmCount--,
              (e._isDestroyed = !0),
              e.__patch__(e._vnode, null),
              Yt(e, "destroyed"),
              e.$off(),
              e.$el && (e.$el.__vue__ = null),
              e.$vnode && (e.$vnode.parent = null));
          }
        }));
    })(wn),
    (function (e) {
      (St(e.prototype),
        (e.prototype.$nextTick = function (e) {
          return Ye(e, this);
        }),
        (e.prototype._render = function () {
          var e,
            t = this,
            n = t.$options,
            r = n.render,
            i = n._parentVnode;
          (i && (t.$scopedSlots = ft(i.data.scopedSlots, t.$slots, t.$scopedSlots)), (t.$vnode = i));
          try {
            ((Ht = t), (e = r.call(t._renderProxy, t.$createElement)));
          } catch (n) {
            (Re(n, t, "render"), (e = t._vnode));
          } finally {
            Ht = null;
          }
          return (Array.isArray(e) && 1 === e.length && (e = e[0]), e instanceof pe || (e = ve()), (e.parent = i), e);
        }));
    })(wn));
  var Sn = [String, RegExp, Array],
    Tn = {
      KeepAlive: {
        name: "keep-alive",
        abstract: !0,
        props: { include: Sn, exclude: Sn, max: [String, Number] },
        created: function () {
          ((this.cache = Object.create(null)), (this.keys = []));
        },
        destroyed: function () {
          for (var e in this.cache) On(this.cache, e, this.keys);
        },
        mounted: function () {
          var e = this;
          (this.$watch("include", function (t) {
            An(e, function (e) {
              return kn(t, e);
            });
          }),
            this.$watch("exclude", function (t) {
              An(e, function (e) {
                return !kn(t, e);
              });
            }));
        },
        render: function () {
          var e = this.$slots.default,
            t = zt(e),
            n = t && t.componentOptions;
          if (n) {
            var r = xn(n),
              i = this.include,
              o = this.exclude;
            if ((i && (!r || !kn(i, r))) || (o && r && kn(o, r))) return t;
            var a = this.cache,
              s = this.keys,
              c = null == t.key ? n.Ctor.cid + (n.tag ? "::" + n.tag : "") : t.key;
            (a[c]
              ? ((t.componentInstance = a[c].componentInstance), h(s, c), s.push(c))
              : ((a[c] = t), s.push(c), this.max && s.length > parseInt(this.max) && On(a, s[0], s, this._vnode)),
              (t.data.keepAlive = !0));
          }
          return t || (e && e[0]);
        },
      },
    };
  (!(function (e) {
    var t = {
      get: function () {
        return F;
      },
    };
    (Object.defineProperty(e, "config", t),
      (e.util = { warn: ae, extend: A, mergeOptions: De, defineReactive: xe }),
      (e.set = ke),
      (e.delete = Ae),
      (e.nextTick = Ye),
      (e.observable = function (e) {
        return (Ce(e), e);
      }),
      (e.options = Object.create(null)),
      M.forEach(function (t) {
        e.options[t + "s"] = Object.create(null);
      }),
      (e.options._base = e),
      A(e.options.components, Tn),
      (function (e) {
        e.use = function (e) {
          var t = this._installedPlugins || (this._installedPlugins = []);
          if (t.indexOf(e) > -1) return this;
          var n = k(arguments, 1);
          return (
            n.unshift(this),
            "function" == typeof e.install ? e.install.apply(e, n) : "function" == typeof e && e.apply(null, n),
            t.push(e),
            this
          );
        };
      })(e),
      (function (e) {
        e.mixin = function (e) {
          return ((this.options = De(this.options, e)), this);
        };
      })(e),
      Cn(e),
      (function (e) {
        M.forEach(function (t) {
          e[t] = function (e, n) {
            return n
              ? ("component" === t && s(n) && ((n.name = n.name || e), (n = this.options._base.extend(n))),
                "directive" === t && "function" == typeof n && (n = { bind: n, update: n }),
                (this.options[t + "s"][e] = n),
                n)
              : this.options[t + "s"][e];
          };
        });
      })(e));
  })(wn),
    Object.defineProperty(wn.prototype, "$isServer", { get: te }),
    Object.defineProperty(wn.prototype, "$ssrContext", {
      get: function () {
        return this.$vnode && this.$vnode.ssrContext;
      },
    }),
    Object.defineProperty(wn, "FunctionalRenderContext", { value: Tt }),
    (wn.version = "2.6.10"));
  var En = p("style,class"),
    Nn = p("input,textarea,option,select,progress"),
    jn = function (e, t, n) {
      return (
        ("value" === n && Nn(e) && "button" !== t) ||
        ("selected" === n && "option" === e) ||
        ("checked" === n && "input" === e) ||
        ("muted" === n && "video" === e)
      );
    },
    Dn = p("contenteditable,draggable,spellcheck"),
    Ln = p("events,caret,typing,plaintext-only"),
    Mn = function (e, t) {
      return Hn(t) || "false" === t ? "false" : "contenteditable" === e && Ln(t) ? t : "true";
    },
    In = p(
      "allowfullscreen,async,autofocus,autoplay,checked,compact,controls,declare,default,defaultchecked,defaultmuted,defaultselected,defer,disabled,enabled,formnovalidate,hidden,indeterminate,inert,ismap,itemscope,loop,multiple,muted,nohref,noresize,noshade,novalidate,nowrap,open,pauseonexit,readonly,required,reversed,scoped,seamless,selected,sortable,translate,truespeed,typemustmatch,visible",
    ),
    Fn = "http://www.w3.org/1999/xlink",
    Pn = function (e) {
      return ":" === e.charAt(5) && "xlink" === e.slice(0, 5);
    },
    Rn = function (e) {
      return Pn(e) ? e.slice(6, e.length) : "";
    },
    Hn = function (e) {
      return null == e || !1 === e;
    };
  function Bn(e) {
    for (var t = e.data, r = e, i = e; n(i.componentInstance);)
      (i = i.componentInstance._vnode) && i.data && (t = Un(i.data, t));
    for (; n((r = r.parent));) r && r.data && (t = Un(t, r.data));
    return (function (e, t) {
      if (n(e) || n(t)) return zn(e, Vn(t));
      return "";
    })(t.staticClass, t.class);
  }
  function Un(e, t) {
    return { staticClass: zn(e.staticClass, t.staticClass), class: n(e.class) ? [e.class, t.class] : t.class };
  }
  function zn(e, t) {
    return e ? (t ? e + " " + t : e) : t || "";
  }
  function Vn(e) {
    return Array.isArray(e)
      ? (function (e) {
          for (var t, r = "", i = 0, o = e.length; i < o; i++)
            n((t = Vn(e[i]))) && "" !== t && (r && (r += " "), (r += t));
          return r;
        })(e)
      : o(e)
        ? (function (e) {
            var t = "";
            for (var n in e) e[n] && (t && (t += " "), (t += n));
            return t;
          })(e)
        : "string" == typeof e
          ? e
          : "";
  }
  var Kn = { svg: "http://www.w3.org/2000/svg", math: "http://www.w3.org/1998/Math/MathML" },
    Jn = p(
      "html,body,base,head,link,meta,style,title,address,article,aside,footer,header,h1,h2,h3,h4,h5,h6,hgroup,nav,section,div,dd,dl,dt,figcaption,figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,data,dfn,em,i,kbd,mark,q,rp,rt,rtc,ruby,s,samp,small,span,strong,sub,sup,time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,option,output,progress,select,textarea,details,dialog,menu,menuitem,summary,content,element,shadow,template,blockquote,iframe,tfoot",
    ),
    qn = p(
      "svg,animate,circle,clippath,cursor,defs,desc,ellipse,filter,font-face,foreignObject,g,glyph,image,line,marker,mask,missing-glyph,path,pattern,polygon,polyline,rect,switch,symbol,text,textpath,tspan,use,view",
      !0,
    ),
    Wn = function (e) {
      return Jn(e) || qn(e);
    };
  function Zn(e) {
    return qn(e) ? "svg" : "math" === e ? "math" : void 0;
  }
  var Gn = Object.create(null);
  var Xn = p("text,number,password,search,email,tel,url");
  function Yn(e) {
    if ("string" == typeof e) {
      var t = document.querySelector(e);
      return t || document.createElement("div");
    }
    return e;
  }
  var Qn = Object.freeze({
      createElement: function (e, t) {
        var n = document.createElement(e);
        return "select" !== e
          ? n
          : (t.data && t.data.attrs && void 0 !== t.data.attrs.multiple && n.setAttribute("multiple", "multiple"), n);
      },
      createElementNS: function (e, t) {
        return document.createElementNS(Kn[e], t);
      },
      createTextNode: function (e) {
        return document.createTextNode(e);
      },
      createComment: function (e) {
        return document.createComment(e);
      },
      insertBefore: function (e, t, n) {
        e.insertBefore(t, n);
      },
      removeChild: function (e, t) {
        e.removeChild(t);
      },
      appendChild: function (e, t) {
        e.appendChild(t);
      },
      parentNode: function (e) {
        return e.parentNode;
      },
      nextSibling: function (e) {
        return e.nextSibling;
      },
      tagName: function (e) {
        return e.tagName;
      },
      setTextContent: function (e, t) {
        e.textContent = t;
      },
      setStyleScope: function (e, t) {
        e.setAttribute(t, "");
      },
    }),
    er = {
      create: function (e, t) {
        tr(t);
      },
      update: function (e, t) {
        e.data.ref !== t.data.ref && (tr(e, !0), tr(t));
      },
      destroy: function (e) {
        tr(e, !0);
      },
    };
  function tr(e, t) {
    var r = e.data.ref;
    if (n(r)) {
      var i = e.context,
        o = e.componentInstance || e.elm,
        a = i.$refs;
      t
        ? Array.isArray(a[r])
          ? h(a[r], o)
          : a[r] === o && (a[r] = void 0)
        : e.data.refInFor
          ? Array.isArray(a[r])
            ? a[r].indexOf(o) < 0 && a[r].push(o)
            : (a[r] = [o])
          : (a[r] = o);
    }
  }
  var nr = new pe("", {}, []),
    rr = ["create", "activate", "update", "remove", "destroy"];
  function ir(e, i) {
    return (
      e.key === i.key &&
      ((e.tag === i.tag &&
        e.isComment === i.isComment &&
        n(e.data) === n(i.data) &&
        (function (e, t) {
          if ("input" !== e.tag) return !0;
          var r,
            i = n((r = e.data)) && n((r = r.attrs)) && r.type,
            o = n((r = t.data)) && n((r = r.attrs)) && r.type;
          return i === o || (Xn(i) && Xn(o));
        })(e, i)) ||
        (r(e.isAsyncPlaceholder) && e.asyncFactory === i.asyncFactory && t(i.asyncFactory.error)))
    );
  }
  function or(e, t, r) {
    var i,
      o,
      a = {};
    for (i = t; i <= r; ++i) n((o = e[i].key)) && (a[o] = i);
    return a;
  }
  var ar = {
    create: sr,
    update: sr,
    destroy: function (e) {
      sr(e, nr);
    },
  };
  function sr(e, t) {
    (e.data.directives || t.data.directives) &&
      (function (e, t) {
        var n,
          r,
          i,
          o = e === nr,
          a = t === nr,
          s = ur(e.data.directives, e.context),
          c = ur(t.data.directives, t.context),
          u = [],
          l = [];
        for (n in c)
          ((r = s[n]),
            (i = c[n]),
            r
              ? ((i.oldValue = r.value),
                (i.oldArg = r.arg),
                fr(i, "update", t, e),
                i.def && i.def.componentUpdated && l.push(i))
              : (fr(i, "bind", t, e), i.def && i.def.inserted && u.push(i)));
        if (u.length) {
          var f = function () {
            for (var n = 0; n < u.length; n++) fr(u[n], "inserted", t, e);
          };
          o ? it(t, "insert", f) : f();
        }
        l.length &&
          it(t, "postpatch", function () {
            for (var n = 0; n < l.length; n++) fr(l[n], "componentUpdated", t, e);
          });
        if (!o) for (n in s) c[n] || fr(s[n], "unbind", e, e, a);
      })(e, t);
  }
  var cr = Object.create(null);
  function ur(e, t) {
    var n,
      r,
      i = Object.create(null);
    if (!e) return i;
    for (n = 0; n < e.length; n++)
      ((r = e[n]).modifiers || (r.modifiers = cr), (i[lr(r)] = r), (r.def = Le(t.$options, "directives", r.name)));
    return i;
  }
  function lr(e) {
    return e.rawName || e.name + "." + Object.keys(e.modifiers || {}).join(".");
  }
  function fr(e, t, n, r, i) {
    var o = e.def && e.def[t];
    if (o)
      try {
        o(n.elm, e, n, r, i);
      } catch (r) {
        Re(r, n.context, "directive " + e.name + " " + t + " hook");
      }
  }
  var pr = [er, ar];
  function dr(e, r) {
    var i = r.componentOptions;
    if (!((n(i) && !1 === i.Ctor.options.inheritAttrs) || (t(e.data.attrs) && t(r.data.attrs)))) {
      var o,
        a,
        s = r.elm,
        c = e.data.attrs || {},
        u = r.data.attrs || {};
      for (o in (n(u.__ob__) && (u = r.data.attrs = A({}, u)), u)) ((a = u[o]), c[o] !== a && vr(s, o, a));
      for (o in ((q || Z) && u.value !== c.value && vr(s, "value", u.value), c))
        t(u[o]) && (Pn(o) ? s.removeAttributeNS(Fn, Rn(o)) : Dn(o) || s.removeAttribute(o));
    }
  }
  function vr(e, t, n) {
    e.tagName.indexOf("-") > -1
      ? hr(e, t, n)
      : In(t)
        ? Hn(n)
          ? e.removeAttribute(t)
          : ((n = "allowfullscreen" === t && "EMBED" === e.tagName ? "true" : t), e.setAttribute(t, n))
        : Dn(t)
          ? e.setAttribute(t, Mn(t, n))
          : Pn(t)
            ? Hn(n)
              ? e.removeAttributeNS(Fn, Rn(t))
              : e.setAttributeNS(Fn, t, n)
            : hr(e, t, n);
  }
  function hr(e, t, n) {
    if (Hn(n)) e.removeAttribute(t);
    else {
      if (q && !W && "TEXTAREA" === e.tagName && "placeholder" === t && "" !== n && !e.__ieph) {
        var r = function (t) {
          (t.stopImmediatePropagation(), e.removeEventListener("input", r));
        };
        (e.addEventListener("input", r), (e.__ieph = !0));
      }
      e.setAttribute(t, n);
    }
  }
  var mr = { create: dr, update: dr };
  function yr(e, r) {
    var i = r.elm,
      o = r.data,
      a = e.data;
    if (!(t(o.staticClass) && t(o.class) && (t(a) || (t(a.staticClass) && t(a.class))))) {
      var s = Bn(r),
        c = i._transitionClasses;
      (n(c) && (s = zn(s, Vn(c))), s !== i._prevClass && (i.setAttribute("class", s), (i._prevClass = s)));
    }
  }
  var gr,
    _r,
    br,
    $r,
    wr,
    Cr,
    xr = { create: yr, update: yr },
    kr = /[\w).+\-_$\]]/;
  function Ar(e) {
    var t,
      n,
      r,
      i,
      o,
      a = !1,
      s = !1,
      c = !1,
      u = !1,
      l = 0,
      f = 0,
      p = 0,
      d = 0;
    for (r = 0; r < e.length; r++)
      if (((n = t), (t = e.charCodeAt(r)), a)) 39 === t && 92 !== n && (a = !1);
      else if (s) 34 === t && 92 !== n && (s = !1);
      else if (c) 96 === t && 92 !== n && (c = !1);
      else if (u) 47 === t && 92 !== n && (u = !1);
      else if (124 !== t || 124 === e.charCodeAt(r + 1) || 124 === e.charCodeAt(r - 1) || l || f || p) {
        switch (t) {
          case 34:
            s = !0;
            break;
          case 39:
            a = !0;
            break;
          case 96:
            c = !0;
            break;
          case 40:
            p++;
            break;
          case 41:
            p--;
            break;
          case 91:
            f++;
            break;
          case 93:
            f--;
            break;
          case 123:
            l++;
            break;
          case 125:
            l--;
        }
        if (47 === t) {
          for (var v = r - 1, h = void 0; v >= 0 && " " === (h = e.charAt(v)); v--);
          (h && kr.test(h)) || (u = !0);
        }
      } else void 0 === i ? ((d = r + 1), (i = e.slice(0, r).trim())) : m();
    function m() {
      ((o || (o = [])).push(e.slice(d, r).trim()), (d = r + 1));
    }
    if ((void 0 === i ? (i = e.slice(0, r).trim()) : 0 !== d && m(), o)) for (r = 0; r < o.length; r++) i = Or(i, o[r]);
    return i;
  }
  function Or(e, t) {
    var n = t.indexOf("(");
    if (n < 0) return '_f("' + t + '")(' + e + ")";
    var r = t.slice(0, n),
      i = t.slice(n + 1);
    return '_f("' + r + '")(' + e + (")" !== i ? "," + i : i);
  }
  function Sr(e, t) {
    console.error("[Vue compiler]: " + e);
  }
  function Tr(e, t) {
    return e
      ? e
          .map(function (e) {
            return e[t];
          })
          .filter(function (e) {
            return e;
          })
      : [];
  }
  function Er(e, t, n, r, i) {
    ((e.props || (e.props = [])).push(Rr({ name: t, value: n, dynamic: i }, r)), (e.plain = !1));
  }
  function Nr(e, t, n, r, i) {
    ((i ? e.dynamicAttrs || (e.dynamicAttrs = []) : e.attrs || (e.attrs = [])).push(
      Rr({ name: t, value: n, dynamic: i }, r),
    ),
      (e.plain = !1));
  }
  function jr(e, t, n, r) {
    ((e.attrsMap[t] = n), e.attrsList.push(Rr({ name: t, value: n }, r)));
  }
  function Dr(e, t, n, r, i, o, a, s) {
    ((e.directives || (e.directives = [])).push(
      Rr({ name: t, rawName: n, value: r, arg: i, isDynamicArg: o, modifiers: a }, s),
    ),
      (e.plain = !1));
  }
  function Lr(e, t, n) {
    return n ? "_p(" + t + ',"' + e + '")' : e + t;
  }
  function Mr(t, n, r, i, o, a, s, c) {
    var u;
    ((i = i || e).right
      ? c
        ? (n = "(" + n + ")==='click'?'contextmenu':(" + n + ")")
        : "click" === n && ((n = "contextmenu"), delete i.right)
      : i.middle && (c ? (n = "(" + n + ")==='click'?'mouseup':(" + n + ")") : "click" === n && (n = "mouseup")),
      i.capture && (delete i.capture, (n = Lr("!", n, c))),
      i.once && (delete i.once, (n = Lr("~", n, c))),
      i.passive && (delete i.passive, (n = Lr("&", n, c))),
      i.native ? (delete i.native, (u = t.nativeEvents || (t.nativeEvents = {}))) : (u = t.events || (t.events = {})));
    var l = Rr({ value: r.trim(), dynamic: c }, s);
    i !== e && (l.modifiers = i);
    var f = u[n];
    (Array.isArray(f) ? (o ? f.unshift(l) : f.push(l)) : (u[n] = f ? (o ? [l, f] : [f, l]) : l), (t.plain = !1));
  }
  function Ir(e, t, n) {
    var r = Fr(e, ":" + t) || Fr(e, "v-bind:" + t);
    if (null != r) return Ar(r);
    if (!1 !== n) {
      var i = Fr(e, t);
      if (null != i) return JSON.stringify(i);
    }
  }
  function Fr(e, t, n) {
    var r;
    if (null != (r = e.attrsMap[t]))
      for (var i = e.attrsList, o = 0, a = i.length; o < a; o++)
        if (i[o].name === t) {
          i.splice(o, 1);
          break;
        }
    return (n && delete e.attrsMap[t], r);
  }
  function Pr(e, t) {
    for (var n = e.attrsList, r = 0, i = n.length; r < i; r++) {
      var o = n[r];
      if (t.test(o.name)) return (n.splice(r, 1), o);
    }
  }
  function Rr(e, t) {
    return (t && (null != t.start && (e.start = t.start), null != t.end && (e.end = t.end)), e);
  }
  function Hr(e, t, n) {
    var r = n || {},
      i = r.number,
      o = "$$v";
    (r.trim && (o = "(typeof $$v === 'string'? $$v.trim(): $$v)"), i && (o = "_n(" + o + ")"));
    var a = Br(t, o);
    e.model = { value: "(" + t + ")", expression: JSON.stringify(t), callback: "function ($$v) {" + a + "}" };
  }
  function Br(e, t) {
    var n = (function (e) {
      if (((e = e.trim()), (gr = e.length), e.indexOf("[") < 0 || e.lastIndexOf("]") < gr - 1))
        return ($r = e.lastIndexOf(".")) > -1
          ? { exp: e.slice(0, $r), key: '"' + e.slice($r + 1) + '"' }
          : { exp: e, key: null };
      ((_r = e), ($r = wr = Cr = 0));
      for (; !zr();) Vr((br = Ur())) ? Jr(br) : 91 === br && Kr(br);
      return { exp: e.slice(0, wr), key: e.slice(wr + 1, Cr) };
    })(e);
    return null === n.key ? e + "=" + t : "$set(" + n.exp + ", " + n.key + ", " + t + ")";
  }
  function Ur() {
    return _r.charCodeAt(++$r);
  }
  function zr() {
    return $r >= gr;
  }
  function Vr(e) {
    return 34 === e || 39 === e;
  }
  function Kr(e) {
    var t = 1;
    for (wr = $r; !zr();)
      if (Vr((e = Ur()))) Jr(e);
      else if ((91 === e && t++, 93 === e && t--, 0 === t)) {
        Cr = $r;
        break;
      }
  }
  function Jr(e) {
    for (var t = e; !zr() && (e = Ur()) !== t;);
  }
  var qr,
    Wr = "__r",
    Zr = "__c";
  function Gr(e, t, n) {
    var r = qr;
    return function i() {
      null !== t.apply(null, arguments) && Qr(e, i, n, r);
    };
  }
  var Xr = Ve && !(X && Number(X[1]) <= 53);
  function Yr(e, t, n, r) {
    if (Xr) {
      var i = an,
        o = t;
      t = o._wrapper = function (e) {
        if (e.target === e.currentTarget || e.timeStamp >= i || e.timeStamp <= 0 || e.target.ownerDocument !== document)
          return o.apply(this, arguments);
      };
    }
    qr.addEventListener(e, t, Q ? { capture: n, passive: r } : n);
  }
  function Qr(e, t, n, r) {
    (r || qr).removeEventListener(e, t._wrapper || t, n);
  }
  function ei(e, r) {
    if (!t(e.data.on) || !t(r.data.on)) {
      var i = r.data.on || {},
        o = e.data.on || {};
      ((qr = r.elm),
        (function (e) {
          if (n(e[Wr])) {
            var t = q ? "change" : "input";
            ((e[t] = [].concat(e[Wr], e[t] || [])), delete e[Wr]);
          }
          n(e[Zr]) && ((e.change = [].concat(e[Zr], e.change || [])), delete e[Zr]);
        })(i),
        rt(i, o, Yr, Qr, Gr, r.context),
        (qr = void 0));
    }
  }
  var ti,
    ni = { create: ei, update: ei };
  function ri(e, r) {
    if (!t(e.data.domProps) || !t(r.data.domProps)) {
      var i,
        o,
        a = r.elm,
        s = e.data.domProps || {},
        c = r.data.domProps || {};
      for (i in (n(c.__ob__) && (c = r.data.domProps = A({}, c)), s)) i in c || (a[i] = "");
      for (i in c) {
        if (((o = c[i]), "textContent" === i || "innerHTML" === i)) {
          if ((r.children && (r.children.length = 0), o === s[i])) continue;
          1 === a.childNodes.length && a.removeChild(a.childNodes[0]);
        }
        if ("value" === i && "PROGRESS" !== a.tagName) {
          a._value = o;
          var u = t(o) ? "" : String(o);
          ii(a, u) && (a.value = u);
        } else if ("innerHTML" === i && qn(a.tagName) && t(a.innerHTML)) {
          (ti = ti || document.createElement("div")).innerHTML = "<svg>" + o + "</svg>";
          for (var l = ti.firstChild; a.firstChild;) a.removeChild(a.firstChild);
          for (; l.firstChild;) a.appendChild(l.firstChild);
        } else if (o !== s[i])
          try {
            a[i] = o;
          } catch (e) {}
      }
    }
  }
  function ii(e, t) {
    return (
      !e.composing &&
      ("OPTION" === e.tagName ||
        (function (e, t) {
          var n = !0;
          try {
            n = document.activeElement !== e;
          } catch (e) {}
          return n && e.value !== t;
        })(e, t) ||
        (function (e, t) {
          var r = e.value,
            i = e._vModifiers;
          if (n(i)) {
            if (i.number) return f(r) !== f(t);
            if (i.trim) return r.trim() !== t.trim();
          }
          return r !== t;
        })(e, t))
    );
  }
  var oi = { create: ri, update: ri },
    ai = g(function (e) {
      var t = {},
        n = /:(.+)/;
      return (
        e.split(/;(?![^(]*\))/g).forEach(function (e) {
          if (e) {
            var r = e.split(n);
            r.length > 1 && (t[r[0].trim()] = r[1].trim());
          }
        }),
        t
      );
    });
  function si(e) {
    var t = ci(e.style);
    return e.staticStyle ? A(e.staticStyle, t) : t;
  }
  function ci(e) {
    return Array.isArray(e) ? O(e) : "string" == typeof e ? ai(e) : e;
  }
  var ui,
    li = /^--/,
    fi = /\s*!important$/,
    pi = function (e, t, n) {
      if (li.test(t)) e.style.setProperty(t, n);
      else if (fi.test(n)) e.style.setProperty(C(t), n.replace(fi, ""), "important");
      else {
        var r = vi(t);
        if (Array.isArray(n)) for (var i = 0, o = n.length; i < o; i++) e.style[r] = n[i];
        else e.style[r] = n;
      }
    },
    di = ["Webkit", "Moz", "ms"],
    vi = g(function (e) {
      if (((ui = ui || document.createElement("div").style), "filter" !== (e = b(e)) && e in ui)) return e;
      for (var t = e.charAt(0).toUpperCase() + e.slice(1), n = 0; n < di.length; n++) {
        var r = di[n] + t;
        if (r in ui) return r;
      }
    });
  function hi(e, r) {
    var i = r.data,
      o = e.data;
    if (!(t(i.staticStyle) && t(i.style) && t(o.staticStyle) && t(o.style))) {
      var a,
        s,
        c = r.elm,
        u = o.staticStyle,
        l = o.normalizedStyle || o.style || {},
        f = u || l,
        p = ci(r.data.style) || {};
      r.data.normalizedStyle = n(p.__ob__) ? A({}, p) : p;
      var d = (function (e, t) {
        var n,
          r = {};
        if (t)
          for (var i = e; i.componentInstance;)
            (i = i.componentInstance._vnode) && i.data && (n = si(i.data)) && A(r, n);
        (n = si(e.data)) && A(r, n);
        for (var o = e; (o = o.parent);) o.data && (n = si(o.data)) && A(r, n);
        return r;
      })(r, !0);
      for (s in f) t(d[s]) && pi(c, s, "");
      for (s in d) (a = d[s]) !== f[s] && pi(c, s, null == a ? "" : a);
    }
  }
  var mi = { create: hi, update: hi },
    yi = /\s+/;
  function gi(e, t) {
    if (t && (t = t.trim()))
      if (e.classList)
        t.indexOf(" ") > -1
          ? t.split(yi).forEach(function (t) {
              return e.classList.add(t);
            })
          : e.classList.add(t);
      else {
        var n = " " + (e.getAttribute("class") || "") + " ";
        n.indexOf(" " + t + " ") < 0 && e.setAttribute("class", (n + t).trim());
      }
  }
  function _i(e, t) {
    if (t && (t = t.trim()))
      if (e.classList)
        (t.indexOf(" ") > -1
          ? t.split(yi).forEach(function (t) {
              return e.classList.remove(t);
            })
          : e.classList.remove(t),
          e.classList.length || e.removeAttribute("class"));
      else {
        for (var n = " " + (e.getAttribute("class") || "") + " ", r = " " + t + " "; n.indexOf(r) >= 0;)
          n = n.replace(r, " ");
        (n = n.trim()) ? e.setAttribute("class", n) : e.removeAttribute("class");
      }
  }
  function bi(e) {
    if (e) {
      if ("object" == typeof e) {
        var t = {};
        return (!1 !== e.css && A(t, $i(e.name || "v")), A(t, e), t);
      }
      return "string" == typeof e ? $i(e) : void 0;
    }
  }
  var $i = g(function (e) {
      return {
        enterClass: e + "-enter",
        enterToClass: e + "-enter-to",
        enterActiveClass: e + "-enter-active",
        leaveClass: e + "-leave",
        leaveToClass: e + "-leave-to",
        leaveActiveClass: e + "-leave-active",
      };
    }),
    wi = z && !W,
    Ci = "transition",
    xi = "animation",
    ki = "transition",
    Ai = "transitionend",
    Oi = "animation",
    Si = "animationend";
  wi &&
    (void 0 === window.ontransitionend &&
      void 0 !== window.onwebkittransitionend &&
      ((ki = "WebkitTransition"), (Ai = "webkitTransitionEnd")),
    void 0 === window.onanimationend &&
      void 0 !== window.onwebkitanimationend &&
      ((Oi = "WebkitAnimation"), (Si = "webkitAnimationEnd")));
  var Ti = z
    ? window.requestAnimationFrame
      ? window.requestAnimationFrame.bind(window)
      : setTimeout
    : function (e) {
        return e();
      };
  function Ei(e) {
    Ti(function () {
      Ti(e);
    });
  }
  function Ni(e, t) {
    var n = e._transitionClasses || (e._transitionClasses = []);
    n.indexOf(t) < 0 && (n.push(t), gi(e, t));
  }
  function ji(e, t) {
    (e._transitionClasses && h(e._transitionClasses, t), _i(e, t));
  }
  function Di(e, t, n) {
    var r = Mi(e, t),
      i = r.type,
      o = r.timeout,
      a = r.propCount;
    if (!i) return n();
    var s = i === Ci ? Ai : Si,
      c = 0,
      u = function () {
        (e.removeEventListener(s, l), n());
      },
      l = function (t) {
        t.target === e && ++c >= a && u();
      };
    (setTimeout(function () {
      c < a && u();
    }, o + 1),
      e.addEventListener(s, l));
  }
  var Li = /\b(transform|all)(,|$)/;
  function Mi(e, t) {
    var n,
      r = window.getComputedStyle(e),
      i = (r[ki + "Delay"] || "").split(", "),
      o = (r[ki + "Duration"] || "").split(", "),
      a = Ii(i, o),
      s = (r[Oi + "Delay"] || "").split(", "),
      c = (r[Oi + "Duration"] || "").split(", "),
      u = Ii(s, c),
      l = 0,
      f = 0;
    return (
      t === Ci
        ? a > 0 && ((n = Ci), (l = a), (f = o.length))
        : t === xi
          ? u > 0 && ((n = xi), (l = u), (f = c.length))
          : (f = (n = (l = Math.max(a, u)) > 0 ? (a > u ? Ci : xi) : null) ? (n === Ci ? o.length : c.length) : 0),
      { type: n, timeout: l, propCount: f, hasTransform: n === Ci && Li.test(r[ki + "Property"]) }
    );
  }
  function Ii(e, t) {
    for (; e.length < t.length;) e = e.concat(e);
    return Math.max.apply(
      null,
      t.map(function (t, n) {
        return Fi(t) + Fi(e[n]);
      }),
    );
  }
  function Fi(e) {
    return 1e3 * Number(e.slice(0, -1).replace(",", "."));
  }
  function Pi(e, r) {
    var i = e.elm;
    n(i._leaveCb) && ((i._leaveCb.cancelled = !0), i._leaveCb());
    var a = bi(e.data.transition);
    if (!t(a) && !n(i._enterCb) && 1 === i.nodeType) {
      for (
        var s = a.css,
          c = a.type,
          u = a.enterClass,
          l = a.enterToClass,
          p = a.enterActiveClass,
          d = a.appearClass,
          v = a.appearToClass,
          h = a.appearActiveClass,
          m = a.beforeEnter,
          y = a.enter,
          g = a.afterEnter,
          _ = a.enterCancelled,
          b = a.beforeAppear,
          $ = a.appear,
          w = a.afterAppear,
          C = a.appearCancelled,
          x = a.duration,
          k = Wt,
          A = Wt.$vnode;
        A && A.parent;
      )
        ((k = A.context), (A = A.parent));
      var O = !k._isMounted || !e.isRootInsert;
      if (!O || $ || "" === $) {
        var S = O && d ? d : u,
          T = O && h ? h : p,
          E = O && v ? v : l,
          N = (O && b) || m,
          j = O && "function" == typeof $ ? $ : y,
          L = (O && w) || g,
          M = (O && C) || _,
          I = f(o(x) ? x.enter : x),
          F = !1 !== s && !W,
          P = Bi(j),
          R = (i._enterCb = D(function () {
            (F && (ji(i, E), ji(i, T)), R.cancelled ? (F && ji(i, S), M && M(i)) : L && L(i), (i._enterCb = null));
          }));
        (e.data.show ||
          it(e, "insert", function () {
            var t = i.parentNode,
              n = t && t._pending && t._pending[e.key];
            (n && n.tag === e.tag && n.elm._leaveCb && n.elm._leaveCb(), j && j(i, R));
          }),
          N && N(i),
          F &&
            (Ni(i, S),
            Ni(i, T),
            Ei(function () {
              (ji(i, S), R.cancelled || (Ni(i, E), P || (Hi(I) ? setTimeout(R, I) : Di(i, c, R))));
            })),
          e.data.show && (r && r(), j && j(i, R)),
          F || P || R());
      }
    }
  }
  function Ri(e, r) {
    var i = e.elm;
    n(i._enterCb) && ((i._enterCb.cancelled = !0), i._enterCb());
    var a = bi(e.data.transition);
    if (t(a) || 1 !== i.nodeType) return r();
    if (!n(i._leaveCb)) {
      var s = a.css,
        c = a.type,
        u = a.leaveClass,
        l = a.leaveToClass,
        p = a.leaveActiveClass,
        d = a.beforeLeave,
        v = a.leave,
        h = a.afterLeave,
        m = a.leaveCancelled,
        y = a.delayLeave,
        g = a.duration,
        _ = !1 !== s && !W,
        b = Bi(v),
        $ = f(o(g) ? g.leave : g),
        w = (i._leaveCb = D(function () {
          (i.parentNode && i.parentNode._pending && (i.parentNode._pending[e.key] = null),
            _ && (ji(i, l), ji(i, p)),
            w.cancelled ? (_ && ji(i, u), m && m(i)) : (r(), h && h(i)),
            (i._leaveCb = null));
        }));
      y ? y(C) : C();
    }
    function C() {
      w.cancelled ||
        (!e.data.show && i.parentNode && ((i.parentNode._pending || (i.parentNode._pending = {}))[e.key] = e),
        d && d(i),
        _ &&
          (Ni(i, u),
          Ni(i, p),
          Ei(function () {
            (ji(i, u), w.cancelled || (Ni(i, l), b || (Hi($) ? setTimeout(w, $) : Di(i, c, w))));
          })),
        v && v(i, w),
        _ || b || w());
    }
  }
  function Hi(e) {
    return "number" == typeof e && !isNaN(e);
  }
  function Bi(e) {
    if (t(e)) return !1;
    var r = e.fns;
    return n(r) ? Bi(Array.isArray(r) ? r[0] : r) : (e._length || e.length) > 1;
  }
  function Ui(e, t) {
    !0 !== t.data.show && Pi(t);
  }
  var zi = (function (e) {
    var o,
      a,
      s = {},
      c = e.modules,
      u = e.nodeOps;
    for (o = 0; o < rr.length; ++o)
      for (s[rr[o]] = [], a = 0; a < c.length; ++a) n(c[a][rr[o]]) && s[rr[o]].push(c[a][rr[o]]);
    function l(e) {
      var t = u.parentNode(e);
      n(t) && u.removeChild(t, e);
    }
    function f(e, t, i, o, a, c, l) {
      if (
        (n(e.elm) && n(c) && (e = c[l] = me(e)),
        (e.isRootInsert = !a),
        !(function (e, t, i, o) {
          var a = e.data;
          if (n(a)) {
            var c = n(e.componentInstance) && a.keepAlive;
            if ((n((a = a.hook)) && n((a = a.init)) && a(e, !1), n(e.componentInstance)))
              return (
                d(e, t),
                v(i, e.elm, o),
                r(c) &&
                  (function (e, t, r, i) {
                    for (var o, a = e; a.componentInstance;)
                      if (((a = a.componentInstance._vnode), n((o = a.data)) && n((o = o.transition)))) {
                        for (o = 0; o < s.activate.length; ++o) s.activate[o](nr, a);
                        t.push(a);
                        break;
                      }
                    v(r, e.elm, i);
                  })(e, t, i, o),
                !0
              );
          }
        })(e, t, i, o))
      ) {
        var f = e.data,
          p = e.children,
          m = e.tag;
        n(m)
          ? ((e.elm = e.ns ? u.createElementNS(e.ns, m) : u.createElement(m, e)),
            g(e),
            h(e, p, t),
            n(f) && y(e, t),
            v(i, e.elm, o))
          : r(e.isComment)
            ? ((e.elm = u.createComment(e.text)), v(i, e.elm, o))
            : ((e.elm = u.createTextNode(e.text)), v(i, e.elm, o));
      }
    }
    function d(e, t) {
      (n(e.data.pendingInsert) && (t.push.apply(t, e.data.pendingInsert), (e.data.pendingInsert = null)),
        (e.elm = e.componentInstance.$el),
        m(e) ? (y(e, t), g(e)) : (tr(e), t.push(e)));
    }
    function v(e, t, r) {
      n(e) && (n(r) ? u.parentNode(r) === e && u.insertBefore(e, t, r) : u.appendChild(e, t));
    }
    function h(e, t, n) {
      if (Array.isArray(t)) for (var r = 0; r < t.length; ++r) f(t[r], n, e.elm, null, !0, t, r);
      else i(e.text) && u.appendChild(e.elm, u.createTextNode(String(e.text)));
    }
    function m(e) {
      for (; e.componentInstance;) e = e.componentInstance._vnode;
      return n(e.tag);
    }
    function y(e, t) {
      for (var r = 0; r < s.create.length; ++r) s.create[r](nr, e);
      n((o = e.data.hook)) && (n(o.create) && o.create(nr, e), n(o.insert) && t.push(e));
    }
    function g(e) {
      var t;
      if (n((t = e.fnScopeId))) u.setStyleScope(e.elm, t);
      else
        for (var r = e; r;)
          (n((t = r.context)) && n((t = t.$options._scopeId)) && u.setStyleScope(e.elm, t), (r = r.parent));
      n((t = Wt)) && t !== e.context && t !== e.fnContext && n((t = t.$options._scopeId)) && u.setStyleScope(e.elm, t);
    }
    function _(e, t, n, r, i, o) {
      for (; r <= i; ++r) f(n[r], o, e, t, !1, n, r);
    }
    function b(e) {
      var t,
        r,
        i = e.data;
      if (n(i)) for (n((t = i.hook)) && n((t = t.destroy)) && t(e), t = 0; t < s.destroy.length; ++t) s.destroy[t](e);
      if (n((t = e.children))) for (r = 0; r < e.children.length; ++r) b(e.children[r]);
    }
    function $(e, t, r, i) {
      for (; r <= i; ++r) {
        var o = t[r];
        n(o) && (n(o.tag) ? (w(o), b(o)) : l(o.elm));
      }
    }
    function w(e, t) {
      if (n(t) || n(e.data)) {
        var r,
          i = s.remove.length + 1;
        for (
          n(t)
            ? (t.listeners += i)
            : (t = (function (e, t) {
                function n() {
                  0 == --n.listeners && l(e);
                }
                return ((n.listeners = t), n);
              })(e.elm, i)),
            n((r = e.componentInstance)) && n((r = r._vnode)) && n(r.data) && w(r, t),
            r = 0;
          r < s.remove.length;
          ++r
        )
          s.remove[r](e, t);
        n((r = e.data.hook)) && n((r = r.remove)) ? r(e, t) : t();
      } else l(e.elm);
    }
    function C(e, t, r, i) {
      for (var o = r; o < i; o++) {
        var a = t[o];
        if (n(a) && ir(e, a)) return o;
      }
    }
    function x(e, i, o, a, c, l) {
      if (e !== i) {
        n(i.elm) && n(a) && (i = a[c] = me(i));
        var p = (i.elm = e.elm);
        if (r(e.isAsyncPlaceholder)) n(i.asyncFactory.resolved) ? O(e.elm, i, o) : (i.isAsyncPlaceholder = !0);
        else if (r(i.isStatic) && r(e.isStatic) && i.key === e.key && (r(i.isCloned) || r(i.isOnce)))
          i.componentInstance = e.componentInstance;
        else {
          var d,
            v = i.data;
          n(v) && n((d = v.hook)) && n((d = d.prepatch)) && d(e, i);
          var h = e.children,
            y = i.children;
          if (n(v) && m(i)) {
            for (d = 0; d < s.update.length; ++d) s.update[d](e, i);
            n((d = v.hook)) && n((d = d.update)) && d(e, i);
          }
          (t(i.text)
            ? n(h) && n(y)
              ? h !== y &&
                (function (e, r, i, o, a) {
                  for (
                    var s,
                      c,
                      l,
                      p = 0,
                      d = 0,
                      v = r.length - 1,
                      h = r[0],
                      m = r[v],
                      y = i.length - 1,
                      g = i[0],
                      b = i[y],
                      w = !a;
                    p <= v && d <= y;
                  )
                    t(h)
                      ? (h = r[++p])
                      : t(m)
                        ? (m = r[--v])
                        : ir(h, g)
                          ? (x(h, g, o, i, d), (h = r[++p]), (g = i[++d]))
                          : ir(m, b)
                            ? (x(m, b, o, i, y), (m = r[--v]), (b = i[--y]))
                            : ir(h, b)
                              ? (x(h, b, o, i, y),
                                w && u.insertBefore(e, h.elm, u.nextSibling(m.elm)),
                                (h = r[++p]),
                                (b = i[--y]))
                              : ir(m, g)
                                ? (x(m, g, o, i, d), w && u.insertBefore(e, m.elm, h.elm), (m = r[--v]), (g = i[++d]))
                                : (t(s) && (s = or(r, p, v)),
                                  t((c = n(g.key) ? s[g.key] : C(g, r, p, v)))
                                    ? f(g, o, e, h.elm, !1, i, d)
                                    : ir((l = r[c]), g)
                                      ? (x(l, g, o, i, d), (r[c] = void 0), w && u.insertBefore(e, l.elm, h.elm))
                                      : f(g, o, e, h.elm, !1, i, d),
                                  (g = i[++d]));
                  p > v ? _(e, t(i[y + 1]) ? null : i[y + 1].elm, i, d, y, o) : d > y && $(0, r, p, v);
                })(p, h, y, o, l)
              : n(y)
                ? (n(e.text) && u.setTextContent(p, ""), _(p, null, y, 0, y.length - 1, o))
                : n(h)
                  ? $(0, h, 0, h.length - 1)
                  : n(e.text) && u.setTextContent(p, "")
            : e.text !== i.text && u.setTextContent(p, i.text),
            n(v) && n((d = v.hook)) && n((d = d.postpatch)) && d(e, i));
        }
      }
    }
    function k(e, t, i) {
      if (r(i) && n(e.parent)) e.parent.data.pendingInsert = t;
      else for (var o = 0; o < t.length; ++o) t[o].data.hook.insert(t[o]);
    }
    var A = p("attrs,class,staticClass,staticStyle,key");
    function O(e, t, i, o) {
      var a,
        s = t.tag,
        c = t.data,
        u = t.children;
      if (((o = o || (c && c.pre)), (t.elm = e), r(t.isComment) && n(t.asyncFactory)))
        return ((t.isAsyncPlaceholder = !0), !0);
      if (n(c) && (n((a = c.hook)) && n((a = a.init)) && a(t, !0), n((a = t.componentInstance)))) return (d(t, i), !0);
      if (n(s)) {
        if (n(u))
          if (e.hasChildNodes())
            if (n((a = c)) && n((a = a.domProps)) && n((a = a.innerHTML))) {
              if (a !== e.innerHTML) return !1;
            } else {
              for (var l = !0, f = e.firstChild, p = 0; p < u.length; p++) {
                if (!f || !O(f, u[p], i, o)) {
                  l = !1;
                  break;
                }
                f = f.nextSibling;
              }
              if (!l || f) return !1;
            }
          else h(t, u, i);
        if (n(c)) {
          var v = !1;
          for (var m in c)
            if (!A(m)) {
              ((v = !0), y(t, i));
              break;
            }
          !v && c.class && et(c.class);
        }
      } else e.data !== t.text && (e.data = t.text);
      return !0;
    }
    return function (e, i, o, a) {
      if (!t(i)) {
        var c,
          l = !1,
          p = [];
        if (t(e)) ((l = !0), f(i, p));
        else {
          var d = n(e.nodeType);
          if (!d && ir(e, i)) x(e, i, p, null, null, a);
          else {
            if (d) {
              if ((1 === e.nodeType && e.hasAttribute(L) && (e.removeAttribute(L), (o = !0)), r(o) && O(e, i, p)))
                return (k(i, p, !0), e);
              ((c = e), (e = new pe(u.tagName(c).toLowerCase(), {}, [], void 0, c)));
            }
            var v = e.elm,
              h = u.parentNode(v);
            if ((f(i, p, v._leaveCb ? null : h, u.nextSibling(v)), n(i.parent)))
              for (var y = i.parent, g = m(i); y;) {
                for (var _ = 0; _ < s.destroy.length; ++_) s.destroy[_](y);
                if (((y.elm = i.elm), g)) {
                  for (var w = 0; w < s.create.length; ++w) s.create[w](nr, y);
                  var C = y.data.hook.insert;
                  if (C.merged) for (var A = 1; A < C.fns.length; A++) C.fns[A]();
                } else tr(y);
                y = y.parent;
              }
            n(h) ? $(0, [e], 0, 0) : n(e.tag) && b(e);
          }
        }
        return (k(i, p, l), i.elm);
      }
      n(e) && b(e);
    };
  })({
    nodeOps: Qn,
    modules: [
      mr,
      xr,
      ni,
      oi,
      mi,
      z
        ? {
            create: Ui,
            activate: Ui,
            remove: function (e, t) {
              !0 !== e.data.show ? Ri(e, t) : t();
            },
          }
        : {},
    ].concat(pr),
  });
  W &&
    document.addEventListener("selectionchange", function () {
      var e = document.activeElement;
      e && e.vmodel && Xi(e, "input");
    });
  var Vi = {
    inserted: function (e, t, n, r) {
      "select" === n.tag
        ? (r.elm && !r.elm._vOptions
            ? it(n, "postpatch", function () {
                Vi.componentUpdated(e, t, n);
              })
            : Ki(e, t, n.context),
          (e._vOptions = [].map.call(e.options, Wi)))
        : ("textarea" === n.tag || Xn(e.type)) &&
          ((e._vModifiers = t.modifiers),
          t.modifiers.lazy ||
            (e.addEventListener("compositionstart", Zi),
            e.addEventListener("compositionend", Gi),
            e.addEventListener("change", Gi),
            W && (e.vmodel = !0)));
    },
    componentUpdated: function (e, t, n) {
      if ("select" === n.tag) {
        Ki(e, t, n.context);
        var r = e._vOptions,
          i = (e._vOptions = [].map.call(e.options, Wi));
        if (
          i.some(function (e, t) {
            return !N(e, r[t]);
          })
        )
          (e.multiple
            ? t.value.some(function (e) {
                return qi(e, i);
              })
            : t.value !== t.oldValue && qi(t.value, i)) && Xi(e, "change");
      }
    },
  };
  function Ki(e, t, n) {
    (Ji(e, t, n),
      (q || Z) &&
        setTimeout(function () {
          Ji(e, t, n);
        }, 0));
  }
  function Ji(e, t, n) {
    var r = t.value,
      i = e.multiple;
    if (!i || Array.isArray(r)) {
      for (var o, a, s = 0, c = e.options.length; s < c; s++)
        if (((a = e.options[s]), i)) ((o = j(r, Wi(a)) > -1), a.selected !== o && (a.selected = o));
        else if (N(Wi(a), r)) return void (e.selectedIndex !== s && (e.selectedIndex = s));
      i || (e.selectedIndex = -1);
    }
  }
  function qi(e, t) {
    return t.every(function (t) {
      return !N(t, e);
    });
  }
  function Wi(e) {
    return "_value" in e ? e._value : e.value;
  }
  function Zi(e) {
    e.target.composing = !0;
  }
  function Gi(e) {
    e.target.composing && ((e.target.composing = !1), Xi(e.target, "input"));
  }
  function Xi(e, t) {
    var n = document.createEvent("HTMLEvents");
    (n.initEvent(t, !0, !0), e.dispatchEvent(n));
  }
  function Yi(e) {
    return !e.componentInstance || (e.data && e.data.transition) ? e : Yi(e.componentInstance._vnode);
  }
  var Qi = {
      model: Vi,
      show: {
        bind: function (e, t, n) {
          var r = t.value,
            i = (n = Yi(n)).data && n.data.transition,
            o = (e.__vOriginalDisplay = "none" === e.style.display ? "" : e.style.display);
          r && i
            ? ((n.data.show = !0),
              Pi(n, function () {
                e.style.display = o;
              }))
            : (e.style.display = r ? o : "none");
        },
        update: function (e, t, n) {
          var r = t.value;
          !r != !t.oldValue &&
            ((n = Yi(n)).data && n.data.transition
              ? ((n.data.show = !0),
                r
                  ? Pi(n, function () {
                      e.style.display = e.__vOriginalDisplay;
                    })
                  : Ri(n, function () {
                      e.style.display = "none";
                    }))
              : (e.style.display = r ? e.__vOriginalDisplay : "none"));
        },
        unbind: function (e, t, n, r, i) {
          i || (e.style.display = e.__vOriginalDisplay);
        },
      },
    },
    eo = {
      name: String,
      appear: Boolean,
      css: Boolean,
      mode: String,
      type: String,
      enterClass: String,
      leaveClass: String,
      enterToClass: String,
      leaveToClass: String,
      enterActiveClass: String,
      leaveActiveClass: String,
      appearClass: String,
      appearActiveClass: String,
      appearToClass: String,
      duration: [Number, String, Object],
    };
  function to(e) {
    var t = e && e.componentOptions;
    return t && t.Ctor.options.abstract ? to(zt(t.children)) : e;
  }
  function no(e) {
    var t = {},
      n = e.$options;
    for (var r in n.propsData) t[r] = e[r];
    var i = n._parentListeners;
    for (var o in i) t[b(o)] = i[o];
    return t;
  }
  function ro(e, t) {
    if (/\d-keep-alive$/.test(t.tag)) return e("keep-alive", { props: t.componentOptions.propsData });
  }
  var io = function (e) {
      return e.tag || Ut(e);
    },
    oo = function (e) {
      return "show" === e.name;
    },
    ao = {
      name: "transition",
      props: eo,
      abstract: !0,
      render: function (e) {
        var t = this,
          n = this.$slots.default;
        if (n && (n = n.filter(io)).length) {
          var r = this.mode,
            o = n[0];
          if (
            (function (e) {
              for (; (e = e.parent);) if (e.data.transition) return !0;
            })(this.$vnode)
          )
            return o;
          var a = to(o);
          if (!a) return o;
          if (this._leaving) return ro(e, o);
          var s = "__transition-" + this._uid + "-";
          a.key =
            null == a.key
              ? a.isComment
                ? s + "comment"
                : s + a.tag
              : i(a.key)
                ? 0 === String(a.key).indexOf(s)
                  ? a.key
                  : s + a.key
                : a.key;
          var c = ((a.data || (a.data = {})).transition = no(this)),
            u = this._vnode,
            l = to(u);
          if (
            (a.data.directives && a.data.directives.some(oo) && (a.data.show = !0),
            l &&
              l.data &&
              !(function (e, t) {
                return t.key === e.key && t.tag === e.tag;
              })(a, l) &&
              !Ut(l) &&
              (!l.componentInstance || !l.componentInstance._vnode.isComment))
          ) {
            var f = (l.data.transition = A({}, c));
            if ("out-in" === r)
              return (
                (this._leaving = !0),
                it(f, "afterLeave", function () {
                  ((t._leaving = !1), t.$forceUpdate());
                }),
                ro(e, o)
              );
            if ("in-out" === r) {
              if (Ut(a)) return u;
              var p,
                d = function () {
                  p();
                };
              (it(c, "afterEnter", d),
                it(c, "enterCancelled", d),
                it(f, "delayLeave", function (e) {
                  p = e;
                }));
            }
          }
          return o;
        }
      },
    },
    so = A({ tag: String, moveClass: String }, eo);
  function co(e) {
    (e.elm._moveCb && e.elm._moveCb(), e.elm._enterCb && e.elm._enterCb());
  }
  function uo(e) {
    e.data.newPos = e.elm.getBoundingClientRect();
  }
  function lo(e) {
    var t = e.data.pos,
      n = e.data.newPos,
      r = t.left - n.left,
      i = t.top - n.top;
    if (r || i) {
      e.data.moved = !0;
      var o = e.elm.style;
      ((o.transform = o.WebkitTransform = "translate(" + r + "px," + i + "px)"), (o.transitionDuration = "0s"));
    }
  }
  delete so.mode;
  var fo = {
    Transition: ao,
    TransitionGroup: {
      props: so,
      beforeMount: function () {
        var e = this,
          t = this._update;
        this._update = function (n, r) {
          var i = Zt(e);
          (e.__patch__(e._vnode, e.kept, !1, !0), (e._vnode = e.kept), i(), t.call(e, n, r));
        };
      },
      render: function (e) {
        for (
          var t = this.tag || this.$vnode.data.tag || "span",
            n = Object.create(null),
            r = (this.prevChildren = this.children),
            i = this.$slots.default || [],
            o = (this.children = []),
            a = no(this),
            s = 0;
          s < i.length;
          s++
        ) {
          var c = i[s];
          c.tag &&
            null != c.key &&
            0 !== String(c.key).indexOf("__vlist") &&
            (o.push(c), (n[c.key] = c), ((c.data || (c.data = {})).transition = a));
        }
        if (r) {
          for (var u = [], l = [], f = 0; f < r.length; f++) {
            var p = r[f];
            ((p.data.transition = a), (p.data.pos = p.elm.getBoundingClientRect()), n[p.key] ? u.push(p) : l.push(p));
          }
          ((this.kept = e(t, null, u)), (this.removed = l));
        }
        return e(t, null, o);
      },
      updated: function () {
        var e = this.prevChildren,
          t = this.moveClass || (this.name || "v") + "-move";
        e.length &&
          this.hasMove(e[0].elm, t) &&
          (e.forEach(co),
          e.forEach(uo),
          e.forEach(lo),
          (this._reflow = document.body.offsetHeight),
          e.forEach(function (e) {
            if (e.data.moved) {
              var n = e.elm,
                r = n.style;
              (Ni(n, t),
                (r.transform = r.WebkitTransform = r.transitionDuration = ""),
                n.addEventListener(
                  Ai,
                  (n._moveCb = function e(r) {
                    (r && r.target !== n) ||
                      (r && !/transform$/.test(r.propertyName)) ||
                      (n.removeEventListener(Ai, e), (n._moveCb = null), ji(n, t));
                  }),
                ));
            }
          }));
      },
      methods: {
        hasMove: function (e, t) {
          if (!wi) return !1;
          if (this._hasMove) return this._hasMove;
          var n = e.cloneNode();
          (e._transitionClasses &&
            e._transitionClasses.forEach(function (e) {
              _i(n, e);
            }),
            gi(n, t),
            (n.style.display = "none"),
            this.$el.appendChild(n));
          var r = Mi(n);
          return (this.$el.removeChild(n), (this._hasMove = r.hasTransform));
        },
      },
    },
  };
  ((wn.config.mustUseProp = jn),
    (wn.config.isReservedTag = Wn),
    (wn.config.isReservedAttr = En),
    (wn.config.getTagNamespace = Zn),
    (wn.config.isUnknownElement = function (e) {
      if (!z) return !0;
      if (Wn(e)) return !1;
      if (((e = e.toLowerCase()), null != Gn[e])) return Gn[e];
      var t = document.createElement(e);
      return e.indexOf("-") > -1
        ? (Gn[e] = t.constructor === window.HTMLUnknownElement || t.constructor === window.HTMLElement)
        : (Gn[e] = /HTMLUnknownElement/.test(t.toString()));
    }),
    A(wn.options.directives, Qi),
    A(wn.options.components, fo),
    (wn.prototype.__patch__ = z ? zi : S),
    (wn.prototype.$mount = function (e, t) {
      return (function (e, t, n) {
        var r;
        return (
          (e.$el = t),
          e.$options.render || (e.$options.render = ve),
          Yt(e, "beforeMount"),
          (r = function () {
            e._update(e._render(), n);
          }),
          new fn(
            e,
            r,
            S,
            {
              before: function () {
                e._isMounted && !e._isDestroyed && Yt(e, "beforeUpdate");
              },
            },
            !0,
          ),
          (n = !1),
          null == e.$vnode && ((e._isMounted = !0), Yt(e, "mounted")),
          e
        );
      })(this, (e = e && z ? Yn(e) : void 0), t);
    }),
    z &&
      setTimeout(function () {
        F.devtools && ne && ne.emit("init", wn);
      }, 0));
  var po = /\{\{((?:.|\r?\n)+?)\}\}/g,
    vo = /[-.*+?^${}()|[\]\/\\]/g,
    ho = g(function (e) {
      var t = e[0].replace(vo, "\\$&"),
        n = e[1].replace(vo, "\\$&");
      return new RegExp(t + "((?:.|\\n)+?)" + n, "g");
    });
  var mo = {
    staticKeys: ["staticClass"],
    transformNode: function (e, t) {
      t.warn;
      var n = Fr(e, "class");
      n && (e.staticClass = JSON.stringify(n));
      var r = Ir(e, "class", !1);
      r && (e.classBinding = r);
    },
    genData: function (e) {
      var t = "";
      return (
        e.staticClass && (t += "staticClass:" + e.staticClass + ","),
        e.classBinding && (t += "class:" + e.classBinding + ","),
        t
      );
    },
  };
  var yo,
    go = {
      staticKeys: ["staticStyle"],
      transformNode: function (e, t) {
        t.warn;
        var n = Fr(e, "style");
        n && (e.staticStyle = JSON.stringify(ai(n)));
        var r = Ir(e, "style", !1);
        r && (e.styleBinding = r);
      },
      genData: function (e) {
        var t = "";
        return (
          e.staticStyle && (t += "staticStyle:" + e.staticStyle + ","),
          e.styleBinding && (t += "style:(" + e.styleBinding + "),"),
          t
        );
      },
    },
    _o = function (e) {
      return (((yo = yo || document.createElement("div")).innerHTML = e), yo.textContent);
    },
    bo = p("area,base,br,col,embed,frame,hr,img,input,isindex,keygen,link,meta,param,source,track,wbr"),
    $o = p("colgroup,dd,dt,li,options,p,td,tfoot,th,thead,tr,source"),
    wo = p(
      "address,article,aside,base,blockquote,body,caption,col,colgroup,dd,details,dialog,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,head,header,hgroup,hr,html,legend,li,menuitem,meta,optgroup,option,param,rp,rt,source,style,summary,tbody,td,tfoot,th,thead,title,tr,track",
    ),
    Co = /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/,
    xo = /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/,
    ko = "[a-zA-Z_][\\-\\.0-9_a-zA-Z" + P.source + "]*",
    Ao = "((?:" + ko + "\\:)?" + ko + ")",
    Oo = new RegExp("^<" + Ao),
    So = /^\s*(\/?)>/,
    To = new RegExp("^<\\/" + Ao + "[^>]*>"),
    Eo = /^<!DOCTYPE [^>]+>/i,
    No = /^<!\--/,
    jo = /^<!\[/,
    Do = p("script,style,textarea", !0),
    Lo = {},
    Mo = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&amp;": "&", "&#10;": "\n", "&#9;": "\t", "&#39;": "'" },
    Io = /&(?:lt|gt|quot|amp|#39);/g,
    Fo = /&(?:lt|gt|quot|amp|#39|#10|#9);/g,
    Po = p("pre,textarea", !0),
    Ro = function (e, t) {
      return e && Po(e) && "\n" === t[0];
    };
  function Ho(e, t) {
    var n = t ? Fo : Io;
    return e.replace(n, function (e) {
      return Mo[e];
    });
  }
  var Bo,
    Uo,
    zo,
    Vo,
    Ko,
    Jo,
    qo,
    Wo,
    Zo = /^@|^v-on:/,
    Go = /^v-|^@|^:/,
    Xo = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/,
    Yo = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/,
    Qo = /^\(|\)$/g,
    ea = /^\[.*\]$/,
    ta = /:(.*)$/,
    na = /^:|^\.|^v-bind:/,
    ra = /\.[^.\]]+(?=[^\]]*$)/g,
    ia = /^v-slot(:|$)|^#/,
    oa = /[\r\n]/,
    aa = /\s+/g,
    sa = g(_o),
    ca = "_empty_";
  function ua(e, t, n) {
    return { type: 1, tag: e, attrsList: t, attrsMap: ma(t), rawAttrsMap: {}, parent: n, children: [] };
  }
  function la(e, t) {
    ((Bo = t.warn || Sr), (Jo = t.isPreTag || T), (qo = t.mustUseProp || T), (Wo = t.getTagNamespace || T));
    t.isReservedTag;
    ((zo = Tr(t.modules, "transformNode")),
      (Vo = Tr(t.modules, "preTransformNode")),
      (Ko = Tr(t.modules, "postTransformNode")),
      (Uo = t.delimiters));
    var n,
      r,
      i = [],
      o = !1 !== t.preserveWhitespace,
      a = t.whitespace,
      s = !1,
      c = !1;
    function u(e) {
      if (
        (l(e),
        s || e.processed || (e = fa(e, t)),
        i.length || e === n || (n.if && (e.elseif || e.else) && da(n, { exp: e.elseif, block: e })),
        r && !e.forbidden)
      )
        if (e.elseif || e.else)
          ((a = e),
            (u = (function (e) {
              var t = e.length;
              for (; t--;) {
                if (1 === e[t].type) return e[t];
                e.pop();
              }
            })(r.children)) &&
              u.if &&
              da(u, { exp: a.elseif, block: a }));
        else {
          if (e.slotScope) {
            var o = e.slotTarget || '"default"';
            (r.scopedSlots || (r.scopedSlots = {}))[o] = e;
          }
          (r.children.push(e), (e.parent = r));
        }
      var a, u;
      ((e.children = e.children.filter(function (e) {
        return !e.slotScope;
      })),
        l(e),
        e.pre && (s = !1),
        Jo(e.tag) && (c = !1));
      for (var f = 0; f < Ko.length; f++) Ko[f](e, t);
    }
    function l(e) {
      if (!c) for (var t; (t = e.children[e.children.length - 1]) && 3 === t.type && " " === t.text;) e.children.pop();
    }
    return (
      (function (e, t) {
        for (var n, r, i = [], o = t.expectHTML, a = t.isUnaryTag || T, s = t.canBeLeftOpenTag || T, c = 0; e;) {
          if (((n = e), r && Do(r))) {
            var u = 0,
              l = r.toLowerCase(),
              f = Lo[l] || (Lo[l] = new RegExp("([\\s\\S]*?)(</" + l + "[^>]*>)", "i")),
              p = e.replace(f, function (e, n, r) {
                return (
                  (u = r.length),
                  Do(l) ||
                    "noscript" === l ||
                    (n = n.replace(/<!\--([\s\S]*?)-->/g, "$1").replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")),
                  Ro(l, n) && (n = n.slice(1)),
                  t.chars && t.chars(n),
                  ""
                );
              });
            ((c += e.length - p.length), (e = p), A(l, c - u, c));
          } else {
            var d = e.indexOf("<");
            if (0 === d) {
              if (No.test(e)) {
                var v = e.indexOf("--\x3e");
                if (v >= 0) {
                  (t.shouldKeepComment && t.comment(e.substring(4, v), c, c + v + 3), C(v + 3));
                  continue;
                }
              }
              if (jo.test(e)) {
                var h = e.indexOf("]>");
                if (h >= 0) {
                  C(h + 2);
                  continue;
                }
              }
              var m = e.match(Eo);
              if (m) {
                C(m[0].length);
                continue;
              }
              var y = e.match(To);
              if (y) {
                var g = c;
                (C(y[0].length), A(y[1], g, c));
                continue;
              }
              var _ = x();
              if (_) {
                (k(_), Ro(_.tagName, e) && C(1));
                continue;
              }
            }
            var b = void 0,
              $ = void 0,
              w = void 0;
            if (d >= 0) {
              for (
                $ = e.slice(d);
                !(To.test($) || Oo.test($) || No.test($) || jo.test($) || (w = $.indexOf("<", 1)) < 0);
              )
                ((d += w), ($ = e.slice(d)));
              b = e.substring(0, d);
            }
            (d < 0 && (b = e), b && C(b.length), t.chars && b && t.chars(b, c - b.length, c));
          }
          if (e === n) {
            t.chars && t.chars(e);
            break;
          }
        }
        function C(t) {
          ((c += t), (e = e.substring(t)));
        }
        function x() {
          var t = e.match(Oo);
          if (t) {
            var n,
              r,
              i = { tagName: t[1], attrs: [], start: c };
            for (C(t[0].length); !(n = e.match(So)) && (r = e.match(xo) || e.match(Co));)
              ((r.start = c), C(r[0].length), (r.end = c), i.attrs.push(r));
            if (n) return ((i.unarySlash = n[1]), C(n[0].length), (i.end = c), i);
          }
        }
        function k(e) {
          var n = e.tagName,
            c = e.unarySlash;
          o && ("p" === r && wo(n) && A(r), s(n) && r === n && A(n));
          for (var u = a(n) || !!c, l = e.attrs.length, f = new Array(l), p = 0; p < l; p++) {
            var d = e.attrs[p],
              v = d[3] || d[4] || d[5] || "",
              h = "a" === n && "href" === d[1] ? t.shouldDecodeNewlinesForHref : t.shouldDecodeNewlines;
            f[p] = { name: d[1], value: Ho(v, h) };
          }
          (u || (i.push({ tag: n, lowerCasedTag: n.toLowerCase(), attrs: f, start: e.start, end: e.end }), (r = n)),
            t.start && t.start(n, f, u, e.start, e.end));
        }
        function A(e, n, o) {
          var a, s;
          if ((null == n && (n = c), null == o && (o = c), e))
            for (s = e.toLowerCase(), a = i.length - 1; a >= 0 && i[a].lowerCasedTag !== s; a--);
          else a = 0;
          if (a >= 0) {
            for (var u = i.length - 1; u >= a; u--) t.end && t.end(i[u].tag, n, o);
            ((i.length = a), (r = a && i[a - 1].tag));
          } else
            "br" === s
              ? t.start && t.start(e, [], !0, n, o)
              : "p" === s && (t.start && t.start(e, [], !1, n, o), t.end && t.end(e, n, o));
        }
        A();
      })(e, {
        warn: Bo,
        expectHTML: t.expectHTML,
        isUnaryTag: t.isUnaryTag,
        canBeLeftOpenTag: t.canBeLeftOpenTag,
        shouldDecodeNewlines: t.shouldDecodeNewlines,
        shouldDecodeNewlinesForHref: t.shouldDecodeNewlinesForHref,
        shouldKeepComment: t.comments,
        outputSourceRange: t.outputSourceRange,
        start: function (e, o, a, l, f) {
          var p = (r && r.ns) || Wo(e);
          q &&
            "svg" === p &&
            (o = (function (e) {
              for (var t = [], n = 0; n < e.length; n++) {
                var r = e[n];
                ya.test(r.name) || ((r.name = r.name.replace(ga, "")), t.push(r));
              }
              return t;
            })(o));
          var d,
            v = ua(e, o, r);
          (p && (v.ns = p),
            ("style" !== (d = v).tag &&
              ("script" !== d.tag || (d.attrsMap.type && "text/javascript" !== d.attrsMap.type))) ||
              te() ||
              (v.forbidden = !0));
          for (var h = 0; h < Vo.length; h++) v = Vo[h](v, t) || v;
          (s ||
            (!(function (e) {
              null != Fr(e, "v-pre") && (e.pre = !0);
            })(v),
            v.pre && (s = !0)),
            Jo(v.tag) && (c = !0),
            s
              ? (function (e) {
                  var t = e.attrsList,
                    n = t.length;
                  if (n)
                    for (var r = (e.attrs = new Array(n)), i = 0; i < n; i++)
                      ((r[i] = { name: t[i].name, value: JSON.stringify(t[i].value) }),
                        null != t[i].start && ((r[i].start = t[i].start), (r[i].end = t[i].end)));
                  else e.pre || (e.plain = !0);
                })(v)
              : v.processed ||
                (pa(v),
                (function (e) {
                  var t = Fr(e, "v-if");
                  if (t) ((e.if = t), da(e, { exp: t, block: e }));
                  else {
                    null != Fr(e, "v-else") && (e.else = !0);
                    var n = Fr(e, "v-else-if");
                    n && (e.elseif = n);
                  }
                })(v),
                (function (e) {
                  null != Fr(e, "v-once") && (e.once = !0);
                })(v)),
            n || (n = v),
            a ? u(v) : ((r = v), i.push(v)));
        },
        end: function (e, t, n) {
          var o = i[i.length - 1];
          ((i.length -= 1), (r = i[i.length - 1]), u(o));
        },
        chars: function (e, t, n) {
          if (r && (!q || "textarea" !== r.tag || r.attrsMap.placeholder !== e)) {
            var i,
              u,
              l,
              f = r.children;
            if (
              (e =
                c || e.trim()
                  ? "script" === (i = r).tag || "style" === i.tag
                    ? e
                    : sa(e)
                  : f.length
                    ? a
                      ? "condense" === a && oa.test(e)
                        ? ""
                        : " "
                      : o
                        ? " "
                        : ""
                    : "")
            )
              (c || "condense" !== a || (e = e.replace(aa, " ")),
                !s &&
                " " !== e &&
                (u = (function (e, t) {
                  var n = t ? ho(t) : po;
                  if (n.test(e)) {
                    for (var r, i, o, a = [], s = [], c = (n.lastIndex = 0); (r = n.exec(e));) {
                      (i = r.index) > c && (s.push((o = e.slice(c, i))), a.push(JSON.stringify(o)));
                      var u = Ar(r[1].trim());
                      (a.push("_s(" + u + ")"), s.push({ "@binding": u }), (c = i + r[0].length));
                    }
                    return (
                      c < e.length && (s.push((o = e.slice(c))), a.push(JSON.stringify(o))),
                      { expression: a.join("+"), tokens: s }
                    );
                  }
                })(e, Uo))
                  ? (l = { type: 2, expression: u.expression, tokens: u.tokens, text: e })
                  : (" " === e && f.length && " " === f[f.length - 1].text) || (l = { type: 3, text: e }),
                l && f.push(l));
          }
        },
        comment: function (e, t, n) {
          if (r) {
            var i = { type: 3, text: e, isComment: !0 };
            r.children.push(i);
          }
        },
      }),
      n
    );
  }
  function fa(e, t) {
    var n, r;
    ((r = Ir((n = e), "key")) && (n.key = r),
      (e.plain = !e.key && !e.scopedSlots && !e.attrsList.length),
      (function (e) {
        var t = Ir(e, "ref");
        t &&
          ((e.ref = t),
          (e.refInFor = (function (e) {
            var t = e;
            for (; t;) {
              if (void 0 !== t.for) return !0;
              t = t.parent;
            }
            return !1;
          })(e)));
      })(e),
      (function (e) {
        var t;
        "template" === e.tag
          ? ((t = Fr(e, "scope")), (e.slotScope = t || Fr(e, "slot-scope")))
          : (t = Fr(e, "slot-scope")) && (e.slotScope = t);
        var n = Ir(e, "slot");
        n &&
          ((e.slotTarget = '""' === n ? '"default"' : n),
          (e.slotTargetDynamic = !(!e.attrsMap[":slot"] && !e.attrsMap["v-bind:slot"])),
          "template" === e.tag ||
            e.slotScope ||
            Nr(
              e,
              "slot",
              n,
              (function (e, t) {
                return e.rawAttrsMap[":" + t] || e.rawAttrsMap["v-bind:" + t] || e.rawAttrsMap[t];
              })(e, "slot"),
            ));
        if ("template" === e.tag) {
          var r = Pr(e, ia);
          if (r) {
            var i = va(r),
              o = i.name,
              a = i.dynamic;
            ((e.slotTarget = o), (e.slotTargetDynamic = a), (e.slotScope = r.value || ca));
          }
        } else {
          var s = Pr(e, ia);
          if (s) {
            var c = e.scopedSlots || (e.scopedSlots = {}),
              u = va(s),
              l = u.name,
              f = u.dynamic,
              p = (c[l] = ua("template", [], e));
            ((p.slotTarget = l),
              (p.slotTargetDynamic = f),
              (p.children = e.children.filter(function (e) {
                if (!e.slotScope) return ((e.parent = p), !0);
              })),
              (p.slotScope = s.value || ca),
              (e.children = []),
              (e.plain = !1));
          }
        }
      })(e),
      (function (e) {
        "slot" === e.tag && (e.slotName = Ir(e, "name"));
      })(e),
      (function (e) {
        var t;
        (t = Ir(e, "is")) && (e.component = t);
        null != Fr(e, "inline-template") && (e.inlineTemplate = !0);
      })(e));
    for (var i = 0; i < zo.length; i++) e = zo[i](e, t) || e;
    return (
      (function (e) {
        var t,
          n,
          r,
          i,
          o,
          a,
          s,
          c,
          u = e.attrsList;
        for (t = 0, n = u.length; t < n; t++)
          if (((r = i = u[t].name), (o = u[t].value), Go.test(r)))
            if (((e.hasBindings = !0), (a = ha(r.replace(Go, ""))) && (r = r.replace(ra, "")), na.test(r)))
              ((r = r.replace(na, "")),
                (o = Ar(o)),
                (c = ea.test(r)) && (r = r.slice(1, -1)),
                a &&
                  (a.prop && !c && "innerHtml" === (r = b(r)) && (r = "innerHTML"),
                  a.camel && !c && (r = b(r)),
                  a.sync &&
                    ((s = Br(o, "$event")),
                    c
                      ? Mr(e, '"update:"+(' + r + ")", s, null, !1, 0, u[t], !0)
                      : (Mr(e, "update:" + b(r), s, null, !1, 0, u[t]),
                        C(r) !== b(r) && Mr(e, "update:" + C(r), s, null, !1, 0, u[t])))),
                (a && a.prop) || (!e.component && qo(e.tag, e.attrsMap.type, r))
                  ? Er(e, r, o, u[t], c)
                  : Nr(e, r, o, u[t], c));
            else if (Zo.test(r))
              ((r = r.replace(Zo, "")), (c = ea.test(r)) && (r = r.slice(1, -1)), Mr(e, r, o, a, !1, 0, u[t], c));
            else {
              var l = (r = r.replace(Go, "")).match(ta),
                f = l && l[1];
              ((c = !1),
                f && ((r = r.slice(0, -(f.length + 1))), ea.test(f) && ((f = f.slice(1, -1)), (c = !0))),
                Dr(e, r, i, o, f, c, a, u[t]));
            }
          else
            (Nr(e, r, JSON.stringify(o), u[t]),
              !e.component && "muted" === r && qo(e.tag, e.attrsMap.type, r) && Er(e, r, "true", u[t]));
      })(e),
      e
    );
  }
  function pa(e) {
    var t;
    if ((t = Fr(e, "v-for"))) {
      var n = (function (e) {
        var t = e.match(Xo);
        if (!t) return;
        var n = {};
        n.for = t[2].trim();
        var r = t[1].trim().replace(Qo, ""),
          i = r.match(Yo);
        i
          ? ((n.alias = r.replace(Yo, "").trim()), (n.iterator1 = i[1].trim()), i[2] && (n.iterator2 = i[2].trim()))
          : (n.alias = r);
        return n;
      })(t);
      n && A(e, n);
    }
  }
  function da(e, t) {
    (e.ifConditions || (e.ifConditions = []), e.ifConditions.push(t));
  }
  function va(e) {
    var t = e.name.replace(ia, "");
    return (
      t || ("#" !== e.name[0] && (t = "default")),
      ea.test(t) ? { name: t.slice(1, -1), dynamic: !0 } : { name: '"' + t + '"', dynamic: !1 }
    );
  }
  function ha(e) {
    var t = e.match(ra);
    if (t) {
      var n = {};
      return (
        t.forEach(function (e) {
          n[e.slice(1)] = !0;
        }),
        n
      );
    }
  }
  function ma(e) {
    for (var t = {}, n = 0, r = e.length; n < r; n++) t[e[n].name] = e[n].value;
    return t;
  }
  var ya = /^xmlns:NS\d+/,
    ga = /^NS\d+:/;
  function _a(e) {
    return ua(e.tag, e.attrsList.slice(), e.parent);
  }
  var ba = [
    mo,
    go,
    {
      preTransformNode: function (e, t) {
        if ("input" === e.tag) {
          var n,
            r = e.attrsMap;
          if (!r["v-model"]) return;
          if (
            ((r[":type"] || r["v-bind:type"]) && (n = Ir(e, "type")),
            r.type || n || !r["v-bind"] || (n = "(" + r["v-bind"] + ").type"),
            n)
          ) {
            var i = Fr(e, "v-if", !0),
              o = i ? "&&(" + i + ")" : "",
              a = null != Fr(e, "v-else", !0),
              s = Fr(e, "v-else-if", !0),
              c = _a(e);
            (pa(c),
              jr(c, "type", "checkbox"),
              fa(c, t),
              (c.processed = !0),
              (c.if = "(" + n + ")==='checkbox'" + o),
              da(c, { exp: c.if, block: c }));
            var u = _a(e);
            (Fr(u, "v-for", !0),
              jr(u, "type", "radio"),
              fa(u, t),
              da(c, { exp: "(" + n + ")==='radio'" + o, block: u }));
            var l = _a(e);
            return (
              Fr(l, "v-for", !0),
              jr(l, ":type", n),
              fa(l, t),
              da(c, { exp: i, block: l }),
              a ? (c.else = !0) : s && (c.elseif = s),
              c
            );
          }
        }
      },
    },
  ];
  var $a,
    wa,
    Ca = {
      expectHTML: !0,
      modules: ba,
      directives: {
        model: function (e, t, n) {
          var r = t.value,
            i = t.modifiers,
            o = e.tag,
            a = e.attrsMap.type;
          if (e.component) return (Hr(e, r, i), !1);
          if ("select" === o)
            !(function (e, t, n) {
              var r =
                'var $$selectedVal = Array.prototype.filter.call($event.target.options,function(o){return o.selected}).map(function(o){var val = "_value" in o ? o._value : o.value;return ' +
                (n && n.number ? "_n(val)" : "val") +
                "});";
              ((r = r + " " + Br(t, "$event.target.multiple ? $$selectedVal : $$selectedVal[0]")),
                Mr(e, "change", r, null, !0));
            })(e, r, i);
          else if ("input" === o && "checkbox" === a)
            !(function (e, t, n) {
              var r = n && n.number,
                i = Ir(e, "value") || "null",
                o = Ir(e, "true-value") || "true",
                a = Ir(e, "false-value") || "false";
              (Er(
                e,
                "checked",
                "Array.isArray(" +
                  t +
                  ")?_i(" +
                  t +
                  "," +
                  i +
                  ")>-1" +
                  ("true" === o ? ":(" + t + ")" : ":_q(" + t + "," + o + ")"),
              ),
                Mr(
                  e,
                  "change",
                  "var $$a=" +
                    t +
                    ",$$el=$event.target,$$c=$$el.checked?(" +
                    o +
                    "):(" +
                    a +
                    ");if(Array.isArray($$a)){var $$v=" +
                    (r ? "_n(" + i + ")" : i) +
                    ",$$i=_i($$a,$$v);if($$el.checked){$$i<0&&(" +
                    Br(t, "$$a.concat([$$v])") +
                    ")}else{$$i>-1&&(" +
                    Br(t, "$$a.slice(0,$$i).concat($$a.slice($$i+1))") +
                    ")}}else{" +
                    Br(t, "$$c") +
                    "}",
                  null,
                  !0,
                ));
            })(e, r, i);
          else if ("input" === o && "radio" === a)
            !(function (e, t, n) {
              var r = n && n.number,
                i = Ir(e, "value") || "null";
              (Er(e, "checked", "_q(" + t + "," + (i = r ? "_n(" + i + ")" : i) + ")"),
                Mr(e, "change", Br(t, i), null, !0));
            })(e, r, i);
          else if ("input" === o || "textarea" === o)
            !(function (e, t, n) {
              var r = e.attrsMap.type,
                i = n || {},
                o = i.lazy,
                a = i.number,
                s = i.trim,
                c = !o && "range" !== r,
                u = o ? "change" : "range" === r ? Wr : "input",
                l = "$event.target.value";
              (s && (l = "$event.target.value.trim()"), a && (l = "_n(" + l + ")"));
              var f = Br(t, l);
              (c && (f = "if($event.target.composing)return;" + f),
                Er(e, "value", "(" + t + ")"),
                Mr(e, u, f, null, !0),
                (s || a) && Mr(e, "blur", "$forceUpdate()"));
            })(e, r, i);
          else if (!F.isReservedTag(o)) return (Hr(e, r, i), !1);
          return !0;
        },
        text: function (e, t) {
          t.value && Er(e, "textContent", "_s(" + t.value + ")", t);
        },
        html: function (e, t) {
          t.value && Er(e, "innerHTML", "_s(" + t.value + ")", t);
        },
      },
      isPreTag: function (e) {
        return "pre" === e;
      },
      isUnaryTag: bo,
      mustUseProp: jn,
      canBeLeftOpenTag: $o,
      isReservedTag: Wn,
      getTagNamespace: Zn,
      staticKeys: (function (e) {
        return e
          .reduce(function (e, t) {
            return e.concat(t.staticKeys || []);
          }, [])
          .join(",");
      })(ba),
    },
    xa = g(function (e) {
      return p("type,tag,attrsList,attrsMap,plain,parent,children,attrs,start,end,rawAttrsMap" + (e ? "," + e : ""));
    });
  function ka(e, t) {
    e &&
      (($a = xa(t.staticKeys || "")),
      (wa = t.isReservedTag || T),
      (function e(t) {
        t.static = (function (e) {
          if (2 === e.type) return !1;
          if (3 === e.type) return !0;
          return !(
            !e.pre &&
            (e.hasBindings ||
              e.if ||
              e.for ||
              d(e.tag) ||
              !wa(e.tag) ||
              (function (e) {
                for (; e.parent;) {
                  if ("template" !== (e = e.parent).tag) return !1;
                  if (e.for) return !0;
                }
                return !1;
              })(e) ||
              !Object.keys(e).every($a))
          );
        })(t);
        if (1 === t.type) {
          if (!wa(t.tag) && "slot" !== t.tag && null == t.attrsMap["inline-template"]) return;
          for (var n = 0, r = t.children.length; n < r; n++) {
            var i = t.children[n];
            (e(i), i.static || (t.static = !1));
          }
          if (t.ifConditions)
            for (var o = 1, a = t.ifConditions.length; o < a; o++) {
              var s = t.ifConditions[o].block;
              (e(s), s.static || (t.static = !1));
            }
        }
      })(e),
      (function e(t, n) {
        if (1 === t.type) {
          if (
            ((t.static || t.once) && (t.staticInFor = n),
            t.static && t.children.length && (1 !== t.children.length || 3 !== t.children[0].type))
          )
            return void (t.staticRoot = !0);
          if (((t.staticRoot = !1), t.children))
            for (var r = 0, i = t.children.length; r < i; r++) e(t.children[r], n || !!t.for);
          if (t.ifConditions) for (var o = 1, a = t.ifConditions.length; o < a; o++) e(t.ifConditions[o].block, n);
        }
      })(e, !1));
  }
  var Aa = /^([\w$_]+|\([^)]*?\))\s*=>|^function\s*(?:[\w$]+)?\s*\(/,
    Oa = /\([^)]*?\);*$/,
    Sa = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\['[^']*?']|\["[^"]*?"]|\[\d+]|\[[A-Za-z_$][\w$]*])*$/,
    Ta = { esc: 27, tab: 9, enter: 13, space: 32, up: 38, left: 37, right: 39, down: 40, delete: [8, 46] },
    Ea = {
      esc: ["Esc", "Escape"],
      tab: "Tab",
      enter: "Enter",
      space: [" ", "Spacebar"],
      up: ["Up", "ArrowUp"],
      left: ["Left", "ArrowLeft"],
      right: ["Right", "ArrowRight"],
      down: ["Down", "ArrowDown"],
      delete: ["Backspace", "Delete", "Del"],
    },
    Na = function (e) {
      return "if(" + e + ")return null;";
    },
    ja = {
      stop: "$event.stopPropagation();",
      prevent: "$event.preventDefault();",
      self: Na("$event.target !== $event.currentTarget"),
      ctrl: Na("!$event.ctrlKey"),
      shift: Na("!$event.shiftKey"),
      alt: Na("!$event.altKey"),
      meta: Na("!$event.metaKey"),
      left: Na("'button' in $event && $event.button !== 0"),
      middle: Na("'button' in $event && $event.button !== 1"),
      right: Na("'button' in $event && $event.button !== 2"),
    };
  function Da(e, t) {
    var n = t ? "nativeOn:" : "on:",
      r = "",
      i = "";
    for (var o in e) {
      var a = La(e[o]);
      e[o] && e[o].dynamic ? (i += o + "," + a + ",") : (r += '"' + o + '":' + a + ",");
    }
    return ((r = "{" + r.slice(0, -1) + "}"), i ? n + "_d(" + r + ",[" + i.slice(0, -1) + "])" : n + r);
  }
  function La(e) {
    if (!e) return "function(){}";
    if (Array.isArray(e))
      return (
        "[" +
        e
          .map(function (e) {
            return La(e);
          })
          .join(",") +
        "]"
      );
    var t = Sa.test(e.value),
      n = Aa.test(e.value),
      r = Sa.test(e.value.replace(Oa, ""));
    if (e.modifiers) {
      var i = "",
        o = "",
        a = [];
      for (var s in e.modifiers)
        if (ja[s]) ((o += ja[s]), Ta[s] && a.push(s));
        else if ("exact" === s) {
          var c = e.modifiers;
          o += Na(
            ["ctrl", "shift", "alt", "meta"]
              .filter(function (e) {
                return !c[e];
              })
              .map(function (e) {
                return "$event." + e + "Key";
              })
              .join("||"),
          );
        } else a.push(s);
      return (
        a.length &&
          (i += (function (e) {
            return "if(!$event.type.indexOf('key')&&" + e.map(Ma).join("&&") + ")return null;";
          })(a)),
        o && (i += o),
        "function($event){" +
          i +
          (t
            ? "return " + e.value + "($event)"
            : n
              ? "return (" + e.value + ")($event)"
              : r
                ? "return " + e.value
                : e.value) +
          "}"
      );
    }
    return t || n ? e.value : "function($event){" + (r ? "return " + e.value : e.value) + "}";
  }
  function Ma(e) {
    var t = parseInt(e, 10);
    if (t) return "$event.keyCode!==" + t;
    var n = Ta[e],
      r = Ea[e];
    return (
      "_k($event.keyCode," + JSON.stringify(e) + "," + JSON.stringify(n) + ",$event.key," + JSON.stringify(r) + ")"
    );
  }
  var Ia = {
      on: function (e, t) {
        e.wrapListeners = function (e) {
          return "_g(" + e + "," + t.value + ")";
        };
      },
      bind: function (e, t) {
        e.wrapData = function (n) {
          return (
            "_b(" +
            n +
            ",'" +
            e.tag +
            "'," +
            t.value +
            "," +
            (t.modifiers && t.modifiers.prop ? "true" : "false") +
            (t.modifiers && t.modifiers.sync ? ",true" : "") +
            ")"
          );
        };
      },
      cloak: S,
    },
    Fa = function (e) {
      ((this.options = e),
        (this.warn = e.warn || Sr),
        (this.transforms = Tr(e.modules, "transformCode")),
        (this.dataGenFns = Tr(e.modules, "genData")),
        (this.directives = A(A({}, Ia), e.directives)));
      var t = e.isReservedTag || T;
      ((this.maybeComponent = function (e) {
        return !!e.component || !t(e.tag);
      }),
        (this.onceId = 0),
        (this.staticRenderFns = []),
        (this.pre = !1));
    };
  function Pa(e, t) {
    var n = new Fa(t);
    return { render: "with(this){return " + (e ? Ra(e, n) : '_c("div")') + "}", staticRenderFns: n.staticRenderFns };
  }
  function Ra(e, t) {
    if ((e.parent && (e.pre = e.pre || e.parent.pre), e.staticRoot && !e.staticProcessed)) return Ha(e, t);
    if (e.once && !e.onceProcessed) return Ba(e, t);
    if (e.for && !e.forProcessed) return za(e, t);
    if (e.if && !e.ifProcessed) return Ua(e, t);
    if ("template" !== e.tag || e.slotTarget || t.pre) {
      if ("slot" === e.tag)
        return (function (e, t) {
          var n = e.slotName || '"default"',
            r = qa(e, t),
            i = "_t(" + n + (r ? "," + r : ""),
            o =
              e.attrs || e.dynamicAttrs
                ? Ga(
                    (e.attrs || []).concat(e.dynamicAttrs || []).map(function (e) {
                      return { name: b(e.name), value: e.value, dynamic: e.dynamic };
                    }),
                  )
                : null,
            a = e.attrsMap["v-bind"];
          (!o && !a) || r || (i += ",null");
          o && (i += "," + o);
          a && (i += (o ? "" : ",null") + "," + a);
          return i + ")";
        })(e, t);
      var n;
      if (e.component)
        n = (function (e, t, n) {
          var r = t.inlineTemplate ? null : qa(t, n, !0);
          return "_c(" + e + "," + Va(t, n) + (r ? "," + r : "") + ")";
        })(e.component, e, t);
      else {
        var r;
        (!e.plain || (e.pre && t.maybeComponent(e))) && (r = Va(e, t));
        var i = e.inlineTemplate ? null : qa(e, t, !0);
        n = "_c('" + e.tag + "'" + (r ? "," + r : "") + (i ? "," + i : "") + ")";
      }
      for (var o = 0; o < t.transforms.length; o++) n = t.transforms[o](e, n);
      return n;
    }
    return qa(e, t) || "void 0";
  }
  function Ha(e, t) {
    e.staticProcessed = !0;
    var n = t.pre;
    return (
      e.pre && (t.pre = e.pre),
      t.staticRenderFns.push("with(this){return " + Ra(e, t) + "}"),
      (t.pre = n),
      "_m(" + (t.staticRenderFns.length - 1) + (e.staticInFor ? ",true" : "") + ")"
    );
  }
  function Ba(e, t) {
    if (((e.onceProcessed = !0), e.if && !e.ifProcessed)) return Ua(e, t);
    if (e.staticInFor) {
      for (var n = "", r = e.parent; r;) {
        if (r.for) {
          n = r.key;
          break;
        }
        r = r.parent;
      }
      return n ? "_o(" + Ra(e, t) + "," + t.onceId++ + "," + n + ")" : Ra(e, t);
    }
    return Ha(e, t);
  }
  function Ua(e, t, n, r) {
    return (
      (e.ifProcessed = !0),
      (function e(t, n, r, i) {
        if (!t.length) return i || "_e()";
        var o = t.shift();
        return o.exp ? "(" + o.exp + ")?" + a(o.block) + ":" + e(t, n, r, i) : "" + a(o.block);
        function a(e) {
          return r ? r(e, n) : e.once ? Ba(e, n) : Ra(e, n);
        }
      })(e.ifConditions.slice(), t, n, r)
    );
  }
  function za(e, t, n, r) {
    var i = e.for,
      o = e.alias,
      a = e.iterator1 ? "," + e.iterator1 : "",
      s = e.iterator2 ? "," + e.iterator2 : "";
    return (
      (e.forProcessed = !0),
      (r || "_l") + "((" + i + "),function(" + o + a + s + "){return " + (n || Ra)(e, t) + "})"
    );
  }
  function Va(e, t) {
    var n = "{",
      r = (function (e, t) {
        var n = e.directives;
        if (!n) return;
        var r,
          i,
          o,
          a,
          s = "directives:[",
          c = !1;
        for (r = 0, i = n.length; r < i; r++) {
          ((o = n[r]), (a = !0));
          var u = t.directives[o.name];
          (u && (a = !!u(e, o, t.warn)),
            a &&
              ((c = !0),
              (s +=
                '{name:"' +
                o.name +
                '",rawName:"' +
                o.rawName +
                '"' +
                (o.value ? ",value:(" + o.value + "),expression:" + JSON.stringify(o.value) : "") +
                (o.arg ? ",arg:" + (o.isDynamicArg ? o.arg : '"' + o.arg + '"') : "") +
                (o.modifiers ? ",modifiers:" + JSON.stringify(o.modifiers) : "") +
                "},")));
        }
        if (c) return s.slice(0, -1) + "]";
      })(e, t);
    (r && (n += r + ","),
      e.key && (n += "key:" + e.key + ","),
      e.ref && (n += "ref:" + e.ref + ","),
      e.refInFor && (n += "refInFor:true,"),
      e.pre && (n += "pre:true,"),
      e.component && (n += 'tag:"' + e.tag + '",'));
    for (var i = 0; i < t.dataGenFns.length; i++) n += t.dataGenFns[i](e);
    if (
      (e.attrs && (n += "attrs:" + Ga(e.attrs) + ","),
      e.props && (n += "domProps:" + Ga(e.props) + ","),
      e.events && (n += Da(e.events, !1) + ","),
      e.nativeEvents && (n += Da(e.nativeEvents, !0) + ","),
      e.slotTarget && !e.slotScope && (n += "slot:" + e.slotTarget + ","),
      e.scopedSlots &&
        (n +=
          (function (e, t, n) {
            var r =
                e.for ||
                Object.keys(t).some(function (e) {
                  var n = t[e];
                  return n.slotTargetDynamic || n.if || n.for || Ka(n);
                }),
              i = !!e.if;
            if (!r)
              for (var o = e.parent; o;) {
                if ((o.slotScope && o.slotScope !== ca) || o.for) {
                  r = !0;
                  break;
                }
                (o.if && (i = !0), (o = o.parent));
              }
            var a = Object.keys(t)
              .map(function (e) {
                return Ja(t[e], n);
              })
              .join(",");
            return (
              "scopedSlots:_u([" +
              a +
              "]" +
              (r ? ",null,true" : "") +
              (!r && i
                ? ",null,false," +
                  (function (e) {
                    var t = 5381,
                      n = e.length;
                    for (; n;) t = (33 * t) ^ e.charCodeAt(--n);
                    return t >>> 0;
                  })(a)
                : "") +
              ")"
            );
          })(e, e.scopedSlots, t) + ","),
      e.model &&
        (n +=
          "model:{value:" +
          e.model.value +
          ",callback:" +
          e.model.callback +
          ",expression:" +
          e.model.expression +
          "},"),
      e.inlineTemplate)
    ) {
      var o = (function (e, t) {
        var n = e.children[0];
        if (n && 1 === n.type) {
          var r = Pa(n, t.options);
          return (
            "inlineTemplate:{render:function(){" +
            r.render +
            "},staticRenderFns:[" +
            r.staticRenderFns
              .map(function (e) {
                return "function(){" + e + "}";
              })
              .join(",") +
            "]}"
          );
        }
      })(e, t);
      o && (n += o + ",");
    }
    return (
      (n = n.replace(/,$/, "") + "}"),
      e.dynamicAttrs && (n = "_b(" + n + ',"' + e.tag + '",' + Ga(e.dynamicAttrs) + ")"),
      e.wrapData && (n = e.wrapData(n)),
      e.wrapListeners && (n = e.wrapListeners(n)),
      n
    );
  }
  function Ka(e) {
    return 1 === e.type && ("slot" === e.tag || e.children.some(Ka));
  }
  function Ja(e, t) {
    var n = e.attrsMap["slot-scope"];
    if (e.if && !e.ifProcessed && !n) return Ua(e, t, Ja, "null");
    if (e.for && !e.forProcessed) return za(e, t, Ja);
    var r = e.slotScope === ca ? "" : String(e.slotScope),
      i =
        "function(" +
        r +
        "){return " +
        ("template" === e.tag
          ? e.if && n
            ? "(" + e.if + ")?" + (qa(e, t) || "undefined") + ":undefined"
            : qa(e, t) || "undefined"
          : Ra(e, t)) +
        "}",
      o = r ? "" : ",proxy:true";
    return "{key:" + (e.slotTarget || '"default"') + ",fn:" + i + o + "}";
  }
  function qa(e, t, n, r, i) {
    var o = e.children;
    if (o.length) {
      var a = o[0];
      if (1 === o.length && a.for && "template" !== a.tag && "slot" !== a.tag) {
        var s = n ? (t.maybeComponent(a) ? ",1" : ",0") : "";
        return "" + (r || Ra)(a, t) + s;
      }
      var c = n
          ? (function (e, t) {
              for (var n = 0, r = 0; r < e.length; r++) {
                var i = e[r];
                if (1 === i.type) {
                  if (
                    Wa(i) ||
                    (i.ifConditions &&
                      i.ifConditions.some(function (e) {
                        return Wa(e.block);
                      }))
                  ) {
                    n = 2;
                    break;
                  }
                  (t(i) ||
                    (i.ifConditions &&
                      i.ifConditions.some(function (e) {
                        return t(e.block);
                      }))) &&
                    (n = 1);
                }
              }
              return n;
            })(o, t.maybeComponent)
          : 0,
        u = i || Za;
      return (
        "[" +
        o
          .map(function (e) {
            return u(e, t);
          })
          .join(",") +
        "]" +
        (c ? "," + c : "")
      );
    }
  }
  function Wa(e) {
    return void 0 !== e.for || "template" === e.tag || "slot" === e.tag;
  }
  function Za(e, t) {
    return 1 === e.type
      ? Ra(e, t)
      : 3 === e.type && e.isComment
        ? ((r = e), "_e(" + JSON.stringify(r.text) + ")")
        : "_v(" + (2 === (n = e).type ? n.expression : Xa(JSON.stringify(n.text))) + ")";
    var n, r;
  }
  function Ga(e) {
    for (var t = "", n = "", r = 0; r < e.length; r++) {
      var i = e[r],
        o = Xa(i.value);
      i.dynamic ? (n += i.name + "," + o + ",") : (t += '"' + i.name + '":' + o + ",");
    }
    return ((t = "{" + t.slice(0, -1) + "}"), n ? "_d(" + t + ",[" + n.slice(0, -1) + "])" : t);
  }
  function Xa(e) {
    return e.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  new RegExp(
    "\\b" +
      "do,if,for,let,new,try,var,case,else,with,await,break,catch,class,const,super,throw,while,yield,delete,export,import,return,switch,default,extends,finally,continue,debugger,function,arguments"
        .split(",")
        .join("\\b|\\b") +
      "\\b",
  );
  function Ya(e, t) {
    try {
      return new Function(e);
    } catch (n) {
      return (t.push({ err: n, code: e }), S);
    }
  }
  function Qa(e) {
    var t = Object.create(null);
    return function (n, r, i) {
      (r = A({}, r)).warn;
      delete r.warn;
      var o = r.delimiters ? String(r.delimiters) + n : n;
      if (t[o]) return t[o];
      var a = e(n, r),
        s = {},
        c = [];
      return (
        (s.render = Ya(a.render, c)),
        (s.staticRenderFns = a.staticRenderFns.map(function (e) {
          return Ya(e, c);
        })),
        (t[o] = s)
      );
    };
  }
  var es,
    ts,
    ns = ((es = function (e, t) {
      var n = la(e.trim(), t);
      !1 !== t.optimize && ka(n, t);
      var r = Pa(n, t);
      return { ast: n, render: r.render, staticRenderFns: r.staticRenderFns };
    }),
    function (e) {
      function t(t, n) {
        var r = Object.create(e),
          i = [],
          o = [];
        if (n)
          for (var a in (n.modules && (r.modules = (e.modules || []).concat(n.modules)),
          n.directives && (r.directives = A(Object.create(e.directives || null), n.directives)),
          n))
            "modules" !== a && "directives" !== a && (r[a] = n[a]);
        r.warn = function (e, t, n) {
          (n ? o : i).push(e);
        };
        var s = es(t.trim(), r);
        return ((s.errors = i), (s.tips = o), s);
      }
      return { compile: t, compileToFunctions: Qa(t) };
    })(Ca),
    rs = (ns.compile, ns.compileToFunctions);
  function is(e) {
    return (
      ((ts = ts || document.createElement("div")).innerHTML = e ? '<a href="\n"/>' : '<div a="\n"/>'),
      ts.innerHTML.indexOf("&#10;") > 0
    );
  }
  var os = !!z && is(!1),
    as = !!z && is(!0),
    ss = g(function (e) {
      var t = Yn(e);
      return t && t.innerHTML;
    }),
    cs = wn.prototype.$mount;
  return (
    (wn.prototype.$mount = function (e, t) {
      if ((e = e && Yn(e)) === document.body || e === document.documentElement) return this;
      var n = this.$options;
      if (!n.render) {
        var r = n.template;
        if (r)
          if ("string" == typeof r) "#" === r.charAt(0) && (r = ss(r));
          else {
            if (!r.nodeType) return this;
            r = r.innerHTML;
          }
        else
          e &&
            (r = (function (e) {
              if (e.outerHTML) return e.outerHTML;
              var t = document.createElement("div");
              return (t.appendChild(e.cloneNode(!0)), t.innerHTML);
            })(e));
        if (r) {
          var i = rs(
              r,
              {
                outputSourceRange: !1,
                shouldDecodeNewlines: os,
                shouldDecodeNewlinesForHref: as,
                delimiters: n.delimiters,
                comments: n.comments,
              },
              this,
            ),
            o = i.render,
            a = i.staticRenderFns;
          ((n.render = o), (n.staticRenderFns = a));
        }
      }
      return cs.call(this, e, t);
    }),
    (wn.compile = rs),
    wn
  );
});
/*!
 * vuex v3.6.2
 * (c) 2021 Evan You
 * @license MIT
 */
!(function (t, e) {
  "object" == typeof exports && "undefined" != typeof module
    ? (module.exports = e())
    : "function" == typeof define && define.amd
      ? define(e)
      : ((t = "undefined" != typeof globalThis ? globalThis : t || self).Vuex = e());
})(this, function () {
  "use strict";
  var t = ("undefined" != typeof window ? window : "undefined" != typeof global ? global : {})
    .__VUE_DEVTOOLS_GLOBAL_HOOK__;
  function e(t, n) {
    if ((void 0 === n && (n = []), null === t || "object" != typeof t)) return t;
    var o,
      r =
        ((o = function (e) {
          return e.original === t;
        }),
        n.filter(o)[0]);
    if (r) return r.copy;
    var i = Array.isArray(t) ? [] : {};
    return (
      n.push({ original: t, copy: i }),
      Object.keys(t).forEach(function (o) {
        i[o] = e(t[o], n);
      }),
      i
    );
  }
  function n(t, e) {
    Object.keys(t).forEach(function (n) {
      return e(t[n], n);
    });
  }
  function o(t) {
    return null !== t && "object" == typeof t;
  }
  var r = function (t, e) {
      ((this.runtime = e), (this._children = Object.create(null)), (this._rawModule = t));
      var n = t.state;
      this.state = ("function" == typeof n ? n() : n) || {};
    },
    i = { namespaced: { configurable: !0 } };
  ((i.namespaced.get = function () {
    return !!this._rawModule.namespaced;
  }),
    (r.prototype.addChild = function (t, e) {
      this._children[t] = e;
    }),
    (r.prototype.removeChild = function (t) {
      delete this._children[t];
    }),
    (r.prototype.getChild = function (t) {
      return this._children[t];
    }),
    (r.prototype.hasChild = function (t) {
      return t in this._children;
    }),
    (r.prototype.update = function (t) {
      ((this._rawModule.namespaced = t.namespaced),
        t.actions && (this._rawModule.actions = t.actions),
        t.mutations && (this._rawModule.mutations = t.mutations),
        t.getters && (this._rawModule.getters = t.getters));
    }),
    (r.prototype.forEachChild = function (t) {
      n(this._children, t);
    }),
    (r.prototype.forEachGetter = function (t) {
      this._rawModule.getters && n(this._rawModule.getters, t);
    }),
    (r.prototype.forEachAction = function (t) {
      this._rawModule.actions && n(this._rawModule.actions, t);
    }),
    (r.prototype.forEachMutation = function (t) {
      this._rawModule.mutations && n(this._rawModule.mutations, t);
    }),
    Object.defineProperties(r.prototype, i));
  var c,
    a = function (t) {
      this.register([], t, !1);
    };
  ((a.prototype.get = function (t) {
    return t.reduce(function (t, e) {
      return t.getChild(e);
    }, this.root);
  }),
    (a.prototype.getNamespace = function (t) {
      var e = this.root;
      return t.reduce(function (t, n) {
        return t + ((e = e.getChild(n)).namespaced ? n + "/" : "");
      }, "");
    }),
    (a.prototype.update = function (t) {
      !(function t(e, n, o) {
        if ((n.update(o), o.modules))
          for (var r in o.modules) {
            if (!n.getChild(r)) return;
            t(e.concat(r), n.getChild(r), o.modules[r]);
          }
      })([], this.root, t);
    }),
    (a.prototype.register = function (t, e, o) {
      var i = this;
      void 0 === o && (o = !0);
      var c = new r(e, o);
      0 === t.length ? (this.root = c) : this.get(t.slice(0, -1)).addChild(t[t.length - 1], c);
      e.modules &&
        n(e.modules, function (e, n) {
          i.register(t.concat(n), e, o);
        });
    }),
    (a.prototype.unregister = function (t) {
      var e = this.get(t.slice(0, -1)),
        n = t[t.length - 1],
        o = e.getChild(n);
      o && o.runtime && e.removeChild(n);
    }),
    (a.prototype.isRegistered = function (t) {
      var e = this.get(t.slice(0, -1)),
        n = t[t.length - 1];
      return !!e && e.hasChild(n);
    }));
  var s = function (e) {
      var n = this;
      (void 0 === e && (e = {}), !c && "undefined" != typeof window && window.Vue && v(window.Vue));
      var o = e.plugins;
      void 0 === o && (o = []);
      var r = e.strict;
      (void 0 === r && (r = !1),
        (this._committing = !1),
        (this._actions = Object.create(null)),
        (this._actionSubscribers = []),
        (this._mutations = Object.create(null)),
        (this._wrappedGetters = Object.create(null)),
        (this._modules = new a(e)),
        (this._modulesNamespaceMap = Object.create(null)),
        (this._subscribers = []),
        (this._watcherVM = new c()),
        (this._makeLocalGettersCache = Object.create(null)));
      var i = this,
        s = this.dispatch,
        u = this.commit;
      ((this.dispatch = function (t, e) {
        return s.call(i, t, e);
      }),
        (this.commit = function (t, e, n) {
          return u.call(i, t, e, n);
        }),
        (this.strict = r));
      var f = this._modules.root.state;
      (p(this, f, [], this._modules.root),
        h(this, f),
        o.forEach(function (t) {
          return t(n);
        }),
        (void 0 !== e.devtools ? e.devtools : c.config.devtools) &&
          (function (e) {
            t &&
              ((e._devtoolHook = t),
              t.emit("vuex:init", e),
              t.on("vuex:travel-to-state", function (t) {
                e.replaceState(t);
              }),
              e.subscribe(
                function (e, n) {
                  t.emit("vuex:mutation", e, n);
                },
                { prepend: !0 },
              ),
              e.subscribeAction(
                function (e, n) {
                  t.emit("vuex:action", e, n);
                },
                { prepend: !0 },
              ));
          })(this));
    },
    u = { state: { configurable: !0 } };
  function f(t, e, n) {
    return (
      e.indexOf(t) < 0 && (n && n.prepend ? e.unshift(t) : e.push(t)),
      function () {
        var n = e.indexOf(t);
        n > -1 && e.splice(n, 1);
      }
    );
  }
  function l(t, e) {
    ((t._actions = Object.create(null)),
      (t._mutations = Object.create(null)),
      (t._wrappedGetters = Object.create(null)),
      (t._modulesNamespaceMap = Object.create(null)));
    var n = t.state;
    (p(t, n, [], t._modules.root, !0), h(t, n, e));
  }
  function h(t, e, o) {
    var r = t._vm;
    ((t.getters = {}), (t._makeLocalGettersCache = Object.create(null)));
    var i = t._wrappedGetters,
      a = {};
    n(i, function (e, n) {
      ((a[n] = (function (t, e) {
        return function () {
          return t(e);
        };
      })(e, t)),
        Object.defineProperty(t.getters, n, {
          get: function () {
            return t._vm[n];
          },
          enumerable: !0,
        }));
    });
    var s = c.config.silent;
    ((c.config.silent = !0),
      (t._vm = new c({ data: { $$state: e }, computed: a })),
      (c.config.silent = s),
      t.strict &&
        (function (t) {
          t._vm.$watch(
            function () {
              return this._data.$$state;
            },
            function () {},
            { deep: !0, sync: !0 },
          );
        })(t),
      r &&
        (o &&
          t._withCommit(function () {
            r._data.$$state = null;
          }),
        c.nextTick(function () {
          return r.$destroy();
        })));
  }
  function p(t, e, n, o, r) {
    var i = !n.length,
      a = t._modules.getNamespace(n);
    if ((o.namespaced && (t._modulesNamespaceMap[a], (t._modulesNamespaceMap[a] = o)), !i && !r)) {
      var s = d(e, n.slice(0, -1)),
        u = n[n.length - 1];
      t._withCommit(function () {
        c.set(s, u, o.state);
      });
    }
    var f = (o.context = (function (t, e, n) {
      var o = "" === e,
        r = {
          dispatch: o
            ? t.dispatch
            : function (n, o, r) {
                var i = m(n, o, r),
                  c = i.payload,
                  a = i.options,
                  s = i.type;
                return ((a && a.root) || (s = e + s), t.dispatch(s, c));
              },
          commit: o
            ? t.commit
            : function (n, o, r) {
                var i = m(n, o, r),
                  c = i.payload,
                  a = i.options,
                  s = i.type;
                ((a && a.root) || (s = e + s), t.commit(s, c, a));
              },
        };
      return (
        Object.defineProperties(r, {
          getters: {
            get: o
              ? function () {
                  return t.getters;
                }
              : function () {
                  return (function (t, e) {
                    if (!t._makeLocalGettersCache[e]) {
                      var n = {},
                        o = e.length;
                      (Object.keys(t.getters).forEach(function (r) {
                        if (r.slice(0, o) === e) {
                          var i = r.slice(o);
                          Object.defineProperty(n, i, {
                            get: function () {
                              return t.getters[r];
                            },
                            enumerable: !0,
                          });
                        }
                      }),
                        (t._makeLocalGettersCache[e] = n));
                    }
                    return t._makeLocalGettersCache[e];
                  })(t, e);
                },
          },
          state: {
            get: function () {
              return d(t.state, n);
            },
          },
        }),
        r
      );
    })(t, a, n));
    (o.forEachMutation(function (e, n) {
      !(function (t, e, n, o) {
        (t._mutations[e] || (t._mutations[e] = [])).push(function (e) {
          n.call(t, o.state, e);
        });
      })(t, a + n, e, f);
    }),
      o.forEachAction(function (e, n) {
        var o = e.root ? n : a + n,
          r = e.handler || e;
        !(function (t, e, n, o) {
          (t._actions[e] || (t._actions[e] = [])).push(function (e) {
            var r,
              i = n.call(
                t,
                {
                  dispatch: o.dispatch,
                  commit: o.commit,
                  getters: o.getters,
                  state: o.state,
                  rootGetters: t.getters,
                  rootState: t.state,
                },
                e,
              );
            return (
              ((r = i) && "function" == typeof r.then) || (i = Promise.resolve(i)),
              t._devtoolHook
                ? i.catch(function (e) {
                    throw (t._devtoolHook.emit("vuex:error", e), e);
                  })
                : i
            );
          });
        })(t, o, r, f);
      }),
      o.forEachGetter(function (e, n) {
        !(function (t, e, n, o) {
          if (t._wrappedGetters[e]) return;
          t._wrappedGetters[e] = function (t) {
            return n(o.state, o.getters, t.state, t.getters);
          };
        })(t, a + n, e, f);
      }),
      o.forEachChild(function (o, i) {
        p(t, e, n.concat(i), o, r);
      }));
  }
  function d(t, e) {
    return e.reduce(function (t, e) {
      return t[e];
    }, t);
  }
  function m(t, e, n) {
    return (o(t) && t.type && ((n = e), (e = t), (t = t.type)), { type: t, payload: e, options: n });
  }
  function v(t) {
    (c && t === c) ||
      (function (t) {
        if (Number(t.version.split(".")[0]) >= 2) t.mixin({ beforeCreate: n });
        else {
          var e = t.prototype._init;
          t.prototype._init = function (t) {
            (void 0 === t && (t = {}), (t.init = t.init ? [n].concat(t.init) : n), e.call(this, t));
          };
        }
        function n() {
          var t = this.$options;
          t.store
            ? (this.$store = "function" == typeof t.store ? t.store() : t.store)
            : t.parent && t.parent.$store && (this.$store = t.parent.$store);
        }
      })((c = t));
  }
  ((u.state.get = function () {
    return this._vm._data.$$state;
  }),
    (u.state.set = function (t) {}),
    (s.prototype.commit = function (t, e, n) {
      var o = this,
        r = m(t, e, n),
        i = r.type,
        c = r.payload,
        a = { type: i, payload: c },
        s = this._mutations[i];
      s &&
        (this._withCommit(function () {
          s.forEach(function (t) {
            t(c);
          });
        }),
        this._subscribers.slice().forEach(function (t) {
          return t(a, o.state);
        }));
    }),
    (s.prototype.dispatch = function (t, e) {
      var n = this,
        o = m(t, e),
        r = o.type,
        i = o.payload,
        c = { type: r, payload: i },
        a = this._actions[r];
      if (a) {
        try {
          this._actionSubscribers
            .slice()
            .filter(function (t) {
              return t.before;
            })
            .forEach(function (t) {
              return t.before(c, n.state);
            });
        } catch (t) {}
        var s =
          a.length > 1
            ? Promise.all(
                a.map(function (t) {
                  return t(i);
                }),
              )
            : a[0](i);
        return new Promise(function (t, e) {
          s.then(
            function (e) {
              try {
                n._actionSubscribers
                  .filter(function (t) {
                    return t.after;
                  })
                  .forEach(function (t) {
                    return t.after(c, n.state);
                  });
              } catch (t) {}
              t(e);
            },
            function (t) {
              try {
                n._actionSubscribers
                  .filter(function (t) {
                    return t.error;
                  })
                  .forEach(function (e) {
                    return e.error(c, n.state, t);
                  });
              } catch (t) {}
              e(t);
            },
          );
        });
      }
    }),
    (s.prototype.subscribe = function (t, e) {
      return f(t, this._subscribers, e);
    }),
    (s.prototype.subscribeAction = function (t, e) {
      return f("function" == typeof t ? { before: t } : t, this._actionSubscribers, e);
    }),
    (s.prototype.watch = function (t, e, n) {
      var o = this;
      return this._watcherVM.$watch(
        function () {
          return t(o.state, o.getters);
        },
        e,
        n,
      );
    }),
    (s.prototype.replaceState = function (t) {
      var e = this;
      this._withCommit(function () {
        e._vm._data.$$state = t;
      });
    }),
    (s.prototype.registerModule = function (t, e, n) {
      (void 0 === n && (n = {}),
        "string" == typeof t && (t = [t]),
        this._modules.register(t, e),
        p(this, this.state, t, this._modules.get(t), n.preserveState),
        h(this, this.state));
    }),
    (s.prototype.unregisterModule = function (t) {
      var e = this;
      ("string" == typeof t && (t = [t]),
        this._modules.unregister(t),
        this._withCommit(function () {
          var n = d(e.state, t.slice(0, -1));
          c.delete(n, t[t.length - 1]);
        }),
        l(this));
    }),
    (s.prototype.hasModule = function (t) {
      return ("string" == typeof t && (t = [t]), this._modules.isRegistered(t));
    }),
    (s.prototype.hotUpdate = function (t) {
      (this._modules.update(t), l(this, !0));
    }),
    (s.prototype._withCommit = function (t) {
      var e = this._committing;
      ((this._committing = !0), t(), (this._committing = e));
    }),
    Object.defineProperties(s.prototype, u));
  var g = M(function (t, e) {
      var n = {};
      return (
        w(e).forEach(function (e) {
          var o = e.key,
            r = e.val;
          ((n[o] = function () {
            var e = this.$store.state,
              n = this.$store.getters;
            if (t) {
              var o = $(this.$store, "mapState", t);
              if (!o) return;
              ((e = o.context.state), (n = o.context.getters));
            }
            return "function" == typeof r ? r.call(this, e, n) : e[r];
          }),
            (n[o].vuex = !0));
        }),
        n
      );
    }),
    y = M(function (t, e) {
      var n = {};
      return (
        w(e).forEach(function (e) {
          var o = e.key,
            r = e.val;
          n[o] = function () {
            for (var e = [], n = arguments.length; n--;) e[n] = arguments[n];
            var o = this.$store.commit;
            if (t) {
              var i = $(this.$store, "mapMutations", t);
              if (!i) return;
              o = i.context.commit;
            }
            return "function" == typeof r ? r.apply(this, [o].concat(e)) : o.apply(this.$store, [r].concat(e));
          };
        }),
        n
      );
    }),
    _ = M(function (t, e) {
      var n = {};
      return (
        w(e).forEach(function (e) {
          var o = e.key,
            r = e.val;
          ((r = t + r),
            (n[o] = function () {
              if (!t || $(this.$store, "mapGetters", t)) return this.$store.getters[r];
            }),
            (n[o].vuex = !0));
        }),
        n
      );
    }),
    b = M(function (t, e) {
      var n = {};
      return (
        w(e).forEach(function (e) {
          var o = e.key,
            r = e.val;
          n[o] = function () {
            for (var e = [], n = arguments.length; n--;) e[n] = arguments[n];
            var o = this.$store.dispatch;
            if (t) {
              var i = $(this.$store, "mapActions", t);
              if (!i) return;
              o = i.context.dispatch;
            }
            return "function" == typeof r ? r.apply(this, [o].concat(e)) : o.apply(this.$store, [r].concat(e));
          };
        }),
        n
      );
    });
  function w(t) {
    return (function (t) {
      return Array.isArray(t) || o(t);
    })(t)
      ? Array.isArray(t)
        ? t.map(function (t) {
            return { key: t, val: t };
          })
        : Object.keys(t).map(function (e) {
            return { key: e, val: t[e] };
          })
      : [];
  }
  function M(t) {
    return function (e, n) {
      return ("string" != typeof e ? ((n = e), (e = "")) : "/" !== e.charAt(e.length - 1) && (e += "/"), t(e, n));
    };
  }
  function $(t, e, n) {
    return t._modulesNamespaceMap[n];
  }
  function C(t, e, n) {
    var o = n ? t.groupCollapsed : t.group;
    try {
      o.call(t, e);
    } catch (n) {
      t.log(e);
    }
  }
  function E(t) {
    try {
      t.groupEnd();
    } catch (e) {
      t.log("—— log end ——");
    }
  }
  function O() {
    var t = new Date();
    return (
      " @ " +
      j(t.getHours(), 2) +
      ":" +
      j(t.getMinutes(), 2) +
      ":" +
      j(t.getSeconds(), 2) +
      "." +
      j(t.getMilliseconds(), 3)
    );
  }
  function j(t, e) {
    return ((n = "0"), (o = e - t.toString().length), new Array(o + 1).join(n) + t);
    var n, o;
  }
  return {
    Store: s,
    install: v,
    version: "3.6.2",
    mapState: g,
    mapMutations: y,
    mapGetters: _,
    mapActions: b,
    createNamespacedHelpers: function (t) {
      return {
        mapState: g.bind(null, t),
        mapGetters: _.bind(null, t),
        mapMutations: y.bind(null, t),
        mapActions: b.bind(null, t),
      };
    },
    createLogger: function (t) {
      void 0 === t && (t = {});
      var n = t.collapsed;
      void 0 === n && (n = !0);
      var o = t.filter;
      void 0 === o &&
        (o = function (t, e, n) {
          return !0;
        });
      var r = t.transformer;
      void 0 === r &&
        (r = function (t) {
          return t;
        });
      var i = t.mutationTransformer;
      void 0 === i &&
        (i = function (t) {
          return t;
        });
      var c = t.actionFilter;
      void 0 === c &&
        (c = function (t, e) {
          return !0;
        });
      var a = t.actionTransformer;
      void 0 === a &&
        (a = function (t) {
          return t;
        });
      var s = t.logMutations;
      void 0 === s && (s = !0);
      var u = t.logActions;
      void 0 === u && (u = !0);
      var f = t.logger;
      return (
        void 0 === f && (f = console),
        function (t) {
          var l = e(t.state);
          void 0 !== f &&
            (s &&
              t.subscribe(function (t, c) {
                var a = e(c);
                if (o(t, l, a)) {
                  var s = O(),
                    u = i(t),
                    h = "mutation " + t.type + s;
                  (C(f, h, n),
                    f.log("%c prev state", "color: #9E9E9E; font-weight: bold", r(l)),
                    f.log("%c mutation", "color: #03A9F4; font-weight: bold", u),
                    f.log("%c next state", "color: #4CAF50; font-weight: bold", r(a)),
                    E(f));
                }
                l = a;
              }),
            u &&
              t.subscribeAction(function (t, e) {
                if (c(t, e)) {
                  var o = O(),
                    r = a(t),
                    i = "action " + t.type + o;
                  (C(f, i, n), f.log("%c action", "color: #03A9F4; font-weight: bold", r), E(f));
                }
              }));
        }
      );
    },
  };
});
/*! This file is auto-generated */
!(function (t, e) {
  "object" == typeof exports && "object" == typeof module
    ? (module.exports = e())
    : "function" == typeof define && define.amd
      ? define([], e)
      : "object" == typeof exports
        ? (exports.ClipboardJS = e())
        : (t.ClipboardJS = e());
})(this, function () {
  return (
    (n = {
      686: function (t, e, n) {
        "use strict";
        n.d(e, {
          default: function () {
            return b;
          },
        });
        var e = n(279),
          e = n.n(e),
          o = n(370),
          i = n.n(o),
          o = n(817),
          r = n.n(o);
        function u(t) {
          try {
            document.execCommand(t);
          } catch (t) {}
        }
        var c = function (t) {
          t = r()(t);
          return (u("cut"), t);
        };
        function a(t, e) {
          ((t = t),
            (o = "rtl" === document.documentElement.getAttribute("dir")),
            ((n = document.createElement("textarea")).style.fontSize = "12pt"),
            (n.style.border = "0"),
            (n.style.padding = "0"),
            (n.style.margin = "0"),
            (n.style.position = "absolute"),
            (n.style[o ? "right" : "left"] = "-9999px"),
            (o = window.pageYOffset || document.documentElement.scrollTop),
            (n.style.top = "".concat(o, "px")),
            n.setAttribute("readonly", ""),
            (n.value = t));
          var n,
            o = n,
            t = (e.container.appendChild(o), r()(o));
          return (u("copy"), o.remove(), t);
        }
        var l = function (t) {
          var e = 1 < arguments.length && void 0 !== arguments[1] ? arguments[1] : { container: document.body },
            n = "";
          return (
            "string" == typeof t
              ? (n = a(t, e))
              : t instanceof HTMLInputElement &&
                  !["text", "search", "url", "tel", "password"].includes(null == t ? void 0 : t.type)
                ? (n = a(t.value, e))
                : ((n = r()(t)), u("copy")),
            n
          );
        };
        function f(t) {
          return (f =
            "function" == typeof Symbol && "symbol" == typeof Symbol.iterator
              ? function (t) {
                  return typeof t;
                }
              : function (t) {
                  return t && "function" == typeof Symbol && t.constructor === Symbol && t !== Symbol.prototype
                    ? "symbol"
                    : typeof t;
                })(t);
        }
        var s = function () {
          var t = 0 < arguments.length && void 0 !== arguments[0] ? arguments[0] : {},
            e = t.action,
            e = void 0 === e ? "copy" : e,
            n = t.container,
            o = t.target,
            t = t.text;
          if ("copy" !== e && "cut" !== e) throw new Error('Invalid "action" value, use either "copy" or "cut"');
          if (void 0 !== o) {
            if (!o || "object" !== f(o) || 1 !== o.nodeType)
              throw new Error('Invalid "target" value, use a valid Element');
            if ("copy" === e && o.hasAttribute("disabled"))
              throw new Error('Invalid "target" attribute. Please use "readonly" instead of "disabled" attribute');
            if ("cut" === e && (o.hasAttribute("readonly") || o.hasAttribute("disabled")))
              throw new Error(
                'Invalid "target" attribute. You can\'t cut text from elements with "readonly" or "disabled" attributes',
              );
          }
          return t ? l(t, { container: n }) : o ? ("cut" === e ? c(o) : l(o, { container: n })) : void 0;
        };
        function p(t) {
          return (p =
            "function" == typeof Symbol && "symbol" == typeof Symbol.iterator
              ? function (t) {
                  return typeof t;
                }
              : function (t) {
                  return t && "function" == typeof Symbol && t.constructor === Symbol && t !== Symbol.prototype
                    ? "symbol"
                    : typeof t;
                })(t);
        }
        function d(t, e) {
          for (var n = 0; n < e.length; n++) {
            var o = e[n];
            ((o.enumerable = o.enumerable || !1),
              (o.configurable = !0),
              "value" in o && (o.writable = !0),
              Object.defineProperty(t, o.key, o));
          }
        }
        function y(t, e) {
          return (y =
            Object.setPrototypeOf ||
            function (t, e) {
              return ((t.__proto__ = e), t);
            })(t, e);
        }
        function h(n) {
          var o = (function () {
            if ("undefined" == typeof Reflect || !Reflect.construct) return !1;
            if (Reflect.construct.sham) return !1;
            if ("function" == typeof Proxy) return !0;
            try {
              return (Date.prototype.toString.call(Reflect.construct(Date, [], function () {})), !0);
            } catch (t) {
              return !1;
            }
          })();
          return function () {
            var t,
              e = v(n),
              e =
                ((t = o ? ((t = v(this).constructor), Reflect.construct(e, arguments, t)) : e.apply(this, arguments)),
                this);
            if (!t || ("object" !== p(t) && "function" != typeof t)) {
              if (void 0 !== e) return e;
              throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
            }
            return t;
          };
        }
        function v(t) {
          return (v = Object.setPrototypeOf
            ? Object.getPrototypeOf
            : function (t) {
                return t.__proto__ || Object.getPrototypeOf(t);
              })(t);
        }
        function m(t, e) {
          t = "data-clipboard-".concat(t);
          if (e.hasAttribute(t)) return e.getAttribute(t);
        }
        var b = (function (t) {
          var e = r;
          if ("function" != typeof t && null !== t)
            throw new TypeError("Super expression must either be null or a function");
          ((e.prototype = Object.create(t && t.prototype, {
            constructor: { value: e, writable: !0, configurable: !0 },
          })),
            t && y(e, t));
          var n,
            o = h(r);
          function r(t, e) {
            var n;
            if (this instanceof r) return ((n = o.call(this)).resolveOptions(e), n.listenClick(t), n);
            throw new TypeError("Cannot call a class as a function");
          }
          return (
            (e = r),
            (t = [
              {
                key: "copy",
                value: function (t) {
                  var e = 1 < arguments.length && void 0 !== arguments[1] ? arguments[1] : { container: document.body };
                  return l(t, e);
                },
              },
              {
                key: "cut",
                value: function (t) {
                  return c(t);
                },
              },
              {
                key: "isSupported",
                value: function () {
                  var t = 0 < arguments.length && void 0 !== arguments[0] ? arguments[0] : ["copy", "cut"],
                    t = "string" == typeof t ? [t] : t,
                    e = !!document.queryCommandSupported;
                  return (
                    t.forEach(function (t) {
                      e = e && !!document.queryCommandSupported(t);
                    }),
                    e
                  );
                },
              },
            ]),
            (n = [
              {
                key: "resolveOptions",
                value: function () {
                  var t = 0 < arguments.length && void 0 !== arguments[0] ? arguments[0] : {};
                  ((this.action = "function" == typeof t.action ? t.action : this.defaultAction),
                    (this.target = "function" == typeof t.target ? t.target : this.defaultTarget),
                    (this.text = "function" == typeof t.text ? t.text : this.defaultText),
                    (this.container = "object" === p(t.container) ? t.container : document.body));
                },
              },
              {
                key: "listenClick",
                value: function (t) {
                  var e = this;
                  this.listener = i()(t, "click", function (t) {
                    return e.onClick(t);
                  });
                },
              },
              {
                key: "onClick",
                value: function (t) {
                  var e = t.delegateTarget || t.currentTarget,
                    t = this.action(e) || "copy",
                    n = s({ action: t, container: this.container, target: this.target(e), text: this.text(e) });
                  this.emit(n ? "success" : "error", {
                    action: t,
                    text: n,
                    trigger: e,
                    clearSelection: function () {
                      (e && e.focus(), window.getSelection().removeAllRanges());
                    },
                  });
                },
              },
              {
                key: "defaultAction",
                value: function (t) {
                  return m("action", t);
                },
              },
              {
                key: "defaultTarget",
                value: function (t) {
                  t = m("target", t);
                  if (t) return document.querySelector(t);
                },
              },
              {
                key: "defaultText",
                value: function (t) {
                  return m("text", t);
                },
              },
              {
                key: "destroy",
                value: function () {
                  this.listener.destroy();
                },
              },
            ]) && d(e.prototype, n),
            t && d(e, t),
            r
          );
        })(e());
      },
      828: function (t) {
        var e;
        ("undefined" == typeof Element ||
          Element.prototype.matches ||
          ((e = Element.prototype).matches =
            e.matchesSelector ||
            e.mozMatchesSelector ||
            e.msMatchesSelector ||
            e.oMatchesSelector ||
            e.webkitMatchesSelector),
          (t.exports = function (t, e) {
            for (; t && 9 !== t.nodeType;) {
              if ("function" == typeof t.matches && t.matches(e)) return t;
              t = t.parentNode;
            }
          }));
      },
      438: function (t, e, n) {
        var u = n(828);
        function i(t, e, n, o, r) {
          var i = function (e, n, t, o) {
            return function (t) {
              ((t.delegateTarget = u(t.target, n)), t.delegateTarget && o.call(e, t));
            };
          }.apply(this, arguments);
          return (
            t.addEventListener(n, i, r),
            {
              destroy: function () {
                t.removeEventListener(n, i, r);
              },
            }
          );
        }
        t.exports = function (t, e, n, o, r) {
          return "function" == typeof t.addEventListener
            ? i.apply(null, arguments)
            : "function" == typeof n
              ? i.bind(null, document).apply(null, arguments)
              : ("string" == typeof t && (t = document.querySelectorAll(t)),
                Array.prototype.map.call(t, function (t) {
                  return i(t, e, n, o, r);
                }));
        };
      },
      879: function (t, n) {
        ((n.node = function (t) {
          return void 0 !== t && t instanceof HTMLElement && 1 === t.nodeType;
        }),
          (n.nodeList = function (t) {
            var e = Object.prototype.toString.call(t);
            return (
              void 0 !== t &&
              ("[object NodeList]" === e || "[object HTMLCollection]" === e) &&
              "length" in t &&
              (0 === t.length || n.node(t[0]))
            );
          }),
          (n.string = function (t) {
            return "string" == typeof t || t instanceof String;
          }),
          (n.fn = function (t) {
            return "[object Function]" === Object.prototype.toString.call(t);
          }));
      },
      370: function (t, e, n) {
        var l = n(879),
          f = n(438);
        t.exports = function (t, e, n) {
          if (!t && !e && !n) throw new Error("Missing required arguments");
          if (!l.string(e)) throw new TypeError("Second argument must be a String");
          if (!l.fn(n)) throw new TypeError("Third argument must be a Function");
          if (l.node(t))
            return (
              (c = e),
              (a = n),
              (u = t).addEventListener(c, a),
              {
                destroy: function () {
                  u.removeEventListener(c, a);
                },
              }
            );
          if (l.nodeList(t))
            return (
              (o = t),
              (r = e),
              (i = n),
              Array.prototype.forEach.call(o, function (t) {
                t.addEventListener(r, i);
              }),
              {
                destroy: function () {
                  Array.prototype.forEach.call(o, function (t) {
                    t.removeEventListener(r, i);
                  });
                },
              }
            );
          if (l.string(t)) return f(document.body, t, e, n);
          throw new TypeError("First argument must be a String, HTMLElement, HTMLCollection, or NodeList");
          var o, r, i, u, c, a;
        };
      },
      817: function (t) {
        t.exports = function (t) {
          var e, n;
          return (t =
            "SELECT" === t.nodeName
              ? (t.focus(), t.value)
              : "INPUT" === t.nodeName || "TEXTAREA" === t.nodeName
                ? ((e = t.hasAttribute("readonly")) || t.setAttribute("readonly", ""),
                  t.select(),
                  t.setSelectionRange(0, t.value.length),
                  e || t.removeAttribute("readonly"),
                  t.value)
                : (t.hasAttribute("contenteditable") && t.focus(),
                  (e = window.getSelection()),
                  (n = document.createRange()).selectNodeContents(t),
                  e.removeAllRanges(),
                  e.addRange(n),
                  e.toString()));
        };
      },
      279: function (t) {
        function e() {}
        ((e.prototype = {
          on: function (t, e, n) {
            var o = this.e || (this.e = {});
            return ((o[t] || (o[t] = [])).push({ fn: e, ctx: n }), this);
          },
          once: function (t, e, n) {
            var o = this;
            function r() {
              (o.off(t, r), e.apply(n, arguments));
            }
            return ((r._ = e), this.on(t, r, n));
          },
          emit: function (t) {
            for (
              var e = [].slice.call(arguments, 1),
                n = ((this.e || (this.e = {}))[t] || []).slice(),
                o = 0,
                r = n.length;
              o < r;
              o++
            )
              n[o].fn.apply(n[o].ctx, e);
            return this;
          },
          off: function (t, e) {
            var n = this.e || (this.e = {}),
              o = n[t],
              r = [];
            if (o && e) for (var i = 0, u = o.length; i < u; i++) o[i].fn !== e && o[i].fn._ !== e && r.push(o[i]);
            return (r.length ? (n[t] = r) : delete n[t], this);
          },
        }),
          (t.exports = e),
          (t.exports.TinyEmitter = e));
      },
    }),
    (r = {}),
    (o.n = function (t) {
      var e =
        t && t.__esModule
          ? function () {
              return t.default;
            }
          : function () {
              return t;
            };
      return (o.d(e, { a: e }), e);
    }),
    (o.d = function (t, e) {
      for (var n in e) o.o(e, n) && !o.o(t, n) && Object.defineProperty(t, n, { enumerable: !0, get: e[n] });
    }),
    (o.o = function (t, e) {
      return Object.prototype.hasOwnProperty.call(t, e);
    }),
    o(686).default
  );
  function o(t) {
    var e;
    return (r[t] || ((e = r[t] = { exports: {} }), n[t](e, e.exports, o), e)).exports;
  }
  var n, r;
});

!(function (e, t) {
  "object" == typeof exports && "object" == typeof module
    ? (module.exports = t())
    : "function" == typeof define && define.amd
      ? define([], t)
      : "object" == typeof exports
        ? (exports.axios = t())
        : (e.axios = t());
})(this, function () {
  return (function (e) {
    function t(r) {
      if (n[r]) return n[r].exports;
      var o = (n[r] = { exports: {}, id: r, loaded: !1 });
      return (e[r].call(o.exports, o, o.exports, t), (o.loaded = !0), o.exports);
    }
    var n = {};
    return ((t.m = e), (t.c = n), (t.p = ""), t(0));
  })([
    function (e, t, n) {
      e.exports = n(1);
    },
    function (e, t, n) {
      "use strict";
      function r(e) {
        var t = new s(e),
          n = i(s.prototype.request, t);
        return (o.extend(n, s.prototype, t), o.extend(n, t), n);
      }
      var o = n(2),
        i = n(3),
        s = n(5),
        u = n(6),
        a = r(u);
      ((a.Axios = s),
        (a.create = function (e) {
          return r(o.merge(u, e));
        }),
        (a.Cancel = n(23)),
        (a.CancelToken = n(24)),
        (a.isCancel = n(20)),
        (a.all = function (e) {
          return Promise.all(e);
        }),
        (a.spread = n(25)),
        (e.exports = a),
        (e.exports.default = a));
    },
    function (e, t, n) {
      "use strict";
      function r(e) {
        return "[object Array]" === R.call(e);
      }
      function o(e) {
        return "[object ArrayBuffer]" === R.call(e);
      }
      function i(e) {
        return "undefined" != typeof FormData && e instanceof FormData;
      }
      function s(e) {
        var t;
        return (t =
          "undefined" != typeof ArrayBuffer && ArrayBuffer.isView
            ? ArrayBuffer.isView(e)
            : e && e.buffer && e.buffer instanceof ArrayBuffer);
      }
      function u(e) {
        return "string" == typeof e;
      }
      function a(e) {
        return "number" == typeof e;
      }
      function c(e) {
        return "undefined" == typeof e;
      }
      function f(e) {
        return null !== e && "object" == typeof e;
      }
      function p(e) {
        return "[object Date]" === R.call(e);
      }
      function d(e) {
        return "[object File]" === R.call(e);
      }
      function l(e) {
        return "[object Blob]" === R.call(e);
      }
      function h(e) {
        return "[object Function]" === R.call(e);
      }
      function m(e) {
        return f(e) && h(e.pipe);
      }
      function y(e) {
        return "undefined" != typeof URLSearchParams && e instanceof URLSearchParams;
      }
      function w(e) {
        return e.replace(/^\s*/, "").replace(/\s*$/, "");
      }
      function g() {
        return (
          ("undefined" == typeof navigator || "ReactNative" !== navigator.product) &&
          "undefined" != typeof window &&
          "undefined" != typeof document
        );
      }
      function v(e, t) {
        if (null !== e && "undefined" != typeof e)
          if (("object" != typeof e && (e = [e]), r(e)))
            for (var n = 0, o = e.length; n < o; n++) t.call(null, e[n], n, e);
          else for (var i in e) Object.prototype.hasOwnProperty.call(e, i) && t.call(null, e[i], i, e);
      }
      function x() {
        function e(e, n) {
          "object" == typeof t[n] && "object" == typeof e ? (t[n] = x(t[n], e)) : (t[n] = e);
        }
        for (var t = {}, n = 0, r = arguments.length; n < r; n++) v(arguments[n], e);
        return t;
      }
      function b(e, t, n) {
        return (
          v(t, function (t, r) {
            n && "function" == typeof t ? (e[r] = E(t, n)) : (e[r] = t);
          }),
          e
        );
      }
      var E = n(3),
        C = n(4),
        R = Object.prototype.toString;
      e.exports = {
        isArray: r,
        isArrayBuffer: o,
        isBuffer: C,
        isFormData: i,
        isArrayBufferView: s,
        isString: u,
        isNumber: a,
        isObject: f,
        isUndefined: c,
        isDate: p,
        isFile: d,
        isBlob: l,
        isFunction: h,
        isStream: m,
        isURLSearchParams: y,
        isStandardBrowserEnv: g,
        forEach: v,
        merge: x,
        extend: b,
        trim: w,
      };
    },
    function (e, t) {
      "use strict";
      e.exports = function (e, t) {
        return function () {
          for (var n = new Array(arguments.length), r = 0; r < n.length; r++) n[r] = arguments[r];
          return e.apply(t, n);
        };
      };
    },
    function (e, t) {
      function n(e) {
        return !!e.constructor && "function" == typeof e.constructor.isBuffer && e.constructor.isBuffer(e);
      }
      function r(e) {
        return "function" == typeof e.readFloatLE && "function" == typeof e.slice && n(e.slice(0, 0));
      } /*!
       * Determine if an object is a Buffer
       *
       * @author   Feross Aboukhadijeh <https://feross.org>
       * @license  MIT
       */
      e.exports = function (e) {
        return null != e && (n(e) || r(e) || !!e._isBuffer);
      };
    },
    function (e, t, n) {
      "use strict";
      function r(e) {
        ((this.defaults = e), (this.interceptors = { request: new s(), response: new s() }));
      }
      var o = n(6),
        i = n(2),
        s = n(17),
        u = n(18);
      ((r.prototype.request = function (e) {
        ("string" == typeof e && (e = i.merge({ url: arguments[0] }, arguments[1])),
          (e = i.merge(o, { method: "get" }, this.defaults, e)),
          (e.method = e.method.toLowerCase()));
        var t = [u, void 0],
          n = Promise.resolve(e);
        for (
          this.interceptors.request.forEach(function (e) {
            t.unshift(e.fulfilled, e.rejected);
          }),
            this.interceptors.response.forEach(function (e) {
              t.push(e.fulfilled, e.rejected);
            });
          t.length;
        )
          n = n.then(t.shift(), t.shift());
        return n;
      }),
        i.forEach(["delete", "get", "head", "options"], function (e) {
          r.prototype[e] = function (t, n) {
            return this.request(i.merge(n || {}, { method: e, url: t }));
          };
        }),
        i.forEach(["post", "put", "patch"], function (e) {
          r.prototype[e] = function (t, n, r) {
            return this.request(i.merge(r || {}, { method: e, url: t, data: n }));
          };
        }),
        (e.exports = r));
    },
    function (e, t, n) {
      "use strict";
      function r(e, t) {
        !i.isUndefined(e) && i.isUndefined(e["Content-Type"]) && (e["Content-Type"] = t);
      }
      function o() {
        var e;
        return ("undefined" != typeof XMLHttpRequest ? (e = n(8)) : "undefined" != typeof process && (e = n(8)), e);
      }
      var i = n(2),
        s = n(7),
        u = { "Content-Type": "application/x-www-form-urlencoded" },
        a = {
          adapter: o(),
          transformRequest: [
            function (e, t) {
              return (
                s(t, "Content-Type"),
                i.isFormData(e) || i.isArrayBuffer(e) || i.isBuffer(e) || i.isStream(e) || i.isFile(e) || i.isBlob(e)
                  ? e
                  : i.isArrayBufferView(e)
                    ? e.buffer
                    : i.isURLSearchParams(e)
                      ? (r(t, "application/x-www-form-urlencoded;charset=utf-8"), e.toString())
                      : i.isObject(e)
                        ? (r(t, "application/json;charset=utf-8"), JSON.stringify(e))
                        : e
              );
            },
          ],
          transformResponse: [
            function (e) {
              if ("string" == typeof e)
                try {
                  e = JSON.parse(e);
                } catch (e) {}
              return e;
            },
          ],
          timeout: 0,
          xsrfCookieName: "XSRF-TOKEN",
          xsrfHeaderName: "X-XSRF-TOKEN",
          maxContentLength: -1,
          validateStatus: function (e) {
            return e >= 200 && e < 300;
          },
        };
      ((a.headers = { common: { Accept: "application/json, text/plain, */*" } }),
        i.forEach(["delete", "get", "head"], function (e) {
          a.headers[e] = {};
        }),
        i.forEach(["post", "put", "patch"], function (e) {
          a.headers[e] = i.merge(u);
        }),
        (e.exports = a));
    },
    function (e, t, n) {
      "use strict";
      var r = n(2);
      e.exports = function (e, t) {
        r.forEach(e, function (n, r) {
          r !== t && r.toUpperCase() === t.toUpperCase() && ((e[t] = n), delete e[r]);
        });
      };
    },
    function (e, t, n) {
      "use strict";
      var r = n(2),
        o = n(9),
        i = n(12),
        s = n(13),
        u = n(14),
        a = n(10),
        c = ("undefined" != typeof window && window.btoa && window.btoa.bind(window)) || n(15);
      e.exports = function (e) {
        return new Promise(function (t, f) {
          var p = e.data,
            d = e.headers;
          r.isFormData(p) && delete d["Content-Type"];
          var l = new XMLHttpRequest(),
            h = "onreadystatechange",
            m = !1;
          if (
            ("undefined" == typeof window ||
              !window.XDomainRequest ||
              "withCredentials" in l ||
              u(e.url) ||
              ((l = new window.XDomainRequest()),
              (h = "onload"),
              (m = !0),
              (l.onprogress = function () {}),
              (l.ontimeout = function () {})),
            e.auth)
          ) {
            var y = e.auth.username || "",
              w = e.auth.password || "";
            d.Authorization = "Basic " + c(y + ":" + w);
          }
          if (
            (l.open(e.method.toUpperCase(), i(e.url, e.params, e.paramsSerializer), !0),
            (l.timeout = e.timeout),
            (l[h] = function () {
              if (
                l &&
                (4 === l.readyState || m) &&
                (0 !== l.status || (l.responseURL && 0 === l.responseURL.indexOf("file:")))
              ) {
                var n = "getAllResponseHeaders" in l ? s(l.getAllResponseHeaders()) : null,
                  r = e.responseType && "text" !== e.responseType ? l.response : l.responseText,
                  i = {
                    data: r,
                    status: 1223 === l.status ? 204 : l.status,
                    statusText: 1223 === l.status ? "No Content" : l.statusText,
                    headers: n,
                    config: e,
                    request: l,
                  };
                (o(t, f, i), (l = null));
              }
            }),
            (l.onerror = function () {
              (f(a("Network Error", e, null, l)), (l = null));
            }),
            (l.ontimeout = function () {
              (f(a("timeout of " + e.timeout + "ms exceeded", e, "ECONNABORTED", l)), (l = null));
            }),
            r.isStandardBrowserEnv())
          ) {
            var g = n(16),
              v = (e.withCredentials || u(e.url)) && e.xsrfCookieName ? g.read(e.xsrfCookieName) : void 0;
            v && (d[e.xsrfHeaderName] = v);
          }
          if (
            ("setRequestHeader" in l &&
              r.forEach(d, function (e, t) {
                "undefined" == typeof p && "content-type" === t.toLowerCase() ? delete d[t] : l.setRequestHeader(t, e);
              }),
            e.withCredentials && (l.withCredentials = !0),
            e.responseType)
          )
            try {
              l.responseType = e.responseType;
            } catch (t) {
              if ("json" !== e.responseType) throw t;
            }
          ("function" == typeof e.onDownloadProgress && l.addEventListener("progress", e.onDownloadProgress),
            "function" == typeof e.onUploadProgress &&
              l.upload &&
              l.upload.addEventListener("progress", e.onUploadProgress),
            e.cancelToken &&
              e.cancelToken.promise.then(function (e) {
                l && (l.abort(), f(e), (l = null));
              }),
            void 0 === p && (p = null),
            l.send(p));
        });
      };
    },
    function (e, t, n) {
      "use strict";
      var r = n(10);
      e.exports = function (e, t, n) {
        var o = n.config.validateStatus;
        n.status && o && !o(n.status)
          ? t(r("Request failed with status code " + n.status, n.config, null, n.request, n))
          : e(n);
      };
    },
    function (e, t, n) {
      "use strict";
      var r = n(11);
      e.exports = function (e, t, n, o, i) {
        var s = new Error(e);
        return r(s, t, n, o, i);
      };
    },
    function (e, t) {
      "use strict";
      e.exports = function (e, t, n, r, o) {
        return ((e.config = t), n && (e.code = n), (e.request = r), (e.response = o), e);
      };
    },
    function (e, t, n) {
      "use strict";
      function r(e) {
        return encodeURIComponent(e)
          .replace(/%40/gi, "@")
          .replace(/%3A/gi, ":")
          .replace(/%24/g, "$")
          .replace(/%2C/gi, ",")
          .replace(/%20/g, "+")
          .replace(/%5B/gi, "[")
          .replace(/%5D/gi, "]");
      }
      var o = n(2);
      e.exports = function (e, t, n) {
        if (!t) return e;
        var i;
        if (n) i = n(t);
        else if (o.isURLSearchParams(t)) i = t.toString();
        else {
          var s = [];
          (o.forEach(t, function (e, t) {
            null !== e &&
              "undefined" != typeof e &&
              (o.isArray(e) ? (t += "[]") : (e = [e]),
              o.forEach(e, function (e) {
                (o.isDate(e) ? (e = e.toISOString()) : o.isObject(e) && (e = JSON.stringify(e)),
                  s.push(r(t) + "=" + r(e)));
              }));
          }),
            (i = s.join("&")));
        }
        return (i && (e += (e.indexOf("?") === -1 ? "?" : "&") + i), e);
      };
    },
    function (e, t, n) {
      "use strict";
      var r = n(2),
        o = [
          "age",
          "authorization",
          "content-length",
          "content-type",
          "etag",
          "expires",
          "from",
          "host",
          "if-modified-since",
          "if-unmodified-since",
          "last-modified",
          "location",
          "max-forwards",
          "proxy-authorization",
          "referer",
          "retry-after",
          "user-agent",
        ];
      e.exports = function (e) {
        var t,
          n,
          i,
          s = {};
        return e
          ? (r.forEach(e.split("\n"), function (e) {
              if (
                ((i = e.indexOf(":")), (t = r.trim(e.substr(0, i)).toLowerCase()), (n = r.trim(e.substr(i + 1))), t)
              ) {
                if (s[t] && o.indexOf(t) >= 0) return;
                "set-cookie" === t ? (s[t] = (s[t] ? s[t] : []).concat([n])) : (s[t] = s[t] ? s[t] + ", " + n : n);
              }
            }),
            s)
          : s;
      };
    },
    function (e, t, n) {
      "use strict";
      var r = n(2);
      e.exports = r.isStandardBrowserEnv()
        ? (function () {
            function e(e) {
              var t = e;
              return (
                n && (o.setAttribute("href", t), (t = o.href)),
                o.setAttribute("href", t),
                {
                  href: o.href,
                  protocol: o.protocol ? o.protocol.replace(/:$/, "") : "",
                  host: o.host,
                  search: o.search ? o.search.replace(/^\?/, "") : "",
                  hash: o.hash ? o.hash.replace(/^#/, "") : "",
                  hostname: o.hostname,
                  port: o.port,
                  pathname: "/" === o.pathname.charAt(0) ? o.pathname : "/" + o.pathname,
                }
              );
            }
            var t,
              n = /(msie|trident)/i.test(navigator.userAgent),
              o = document.createElement("a");
            return (
              (t = e(window.location.href)),
              function (n) {
                var o = r.isString(n) ? e(n) : n;
                return o.protocol === t.protocol && o.host === t.host;
              }
            );
          })()
        : (function () {
            return function () {
              return !0;
            };
          })();
    },
    function (e, t) {
      "use strict";
      function n() {
        this.message = "String contains an invalid character";
      }
      function r(e) {
        for (
          var t, r, i = String(e), s = "", u = 0, a = o;
          i.charAt(0 | u) || ((a = "="), u % 1);
          s += a.charAt(63 & (t >> (8 - (u % 1) * 8)))
        ) {
          if (((r = i.charCodeAt((u += 0.75))), r > 255)) throw new n();
          t = (t << 8) | r;
        }
        return s;
      }
      var o = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
      ((n.prototype = new Error()),
        (n.prototype.code = 5),
        (n.prototype.name = "InvalidCharacterError"),
        (e.exports = r));
    },
    function (e, t, n) {
      "use strict";
      var r = n(2);
      e.exports = r.isStandardBrowserEnv()
        ? (function () {
            return {
              write: function (e, t, n, o, i, s) {
                var u = [];
                (u.push(e + "=" + encodeURIComponent(t)),
                  r.isNumber(n) && u.push("expires=" + new Date(n).toGMTString()),
                  r.isString(o) && u.push("path=" + o),
                  r.isString(i) && u.push("domain=" + i),
                  s === !0 && u.push("secure"),
                  (document.cookie = u.join("; ")));
              },
              read: function (e) {
                var t = document.cookie.match(new RegExp("(^|;\\s*)(" + e + ")=([^;]*)"));
                return t ? decodeURIComponent(t[3]) : null;
              },
              remove: function (e) {
                this.write(e, "", Date.now() - 864e5);
              },
            };
          })()
        : (function () {
            return {
              write: function () {},
              read: function () {
                return null;
              },
              remove: function () {},
            };
          })();
    },
    function (e, t, n) {
      "use strict";
      function r() {
        this.handlers = [];
      }
      var o = n(2);
      ((r.prototype.use = function (e, t) {
        return (this.handlers.push({ fulfilled: e, rejected: t }), this.handlers.length - 1);
      }),
        (r.prototype.eject = function (e) {
          this.handlers[e] && (this.handlers[e] = null);
        }),
        (r.prototype.forEach = function (e) {
          o.forEach(this.handlers, function (t) {
            null !== t && e(t);
          });
        }),
        (e.exports = r));
    },
    function (e, t, n) {
      "use strict";
      function r(e) {
        e.cancelToken && e.cancelToken.throwIfRequested();
      }
      var o = n(2),
        i = n(19),
        s = n(20),
        u = n(6),
        a = n(21),
        c = n(22);
      e.exports = function (e) {
        (r(e),
          e.baseURL && !a(e.url) && (e.url = c(e.baseURL, e.url)),
          (e.headers = e.headers || {}),
          (e.data = i(e.data, e.headers, e.transformRequest)),
          (e.headers = o.merge(e.headers.common || {}, e.headers[e.method] || {}, e.headers || {})),
          o.forEach(["delete", "get", "head", "post", "put", "patch", "common"], function (t) {
            delete e.headers[t];
          }));
        var t = e.adapter || u.adapter;
        return t(e).then(
          function (t) {
            return (r(e), (t.data = i(t.data, t.headers, e.transformResponse)), t);
          },
          function (t) {
            return (
              s(t) ||
                (r(e),
                t && t.response && (t.response.data = i(t.response.data, t.response.headers, e.transformResponse))),
              Promise.reject(t)
            );
          },
        );
      };
    },
    function (e, t, n) {
      "use strict";
      var r = n(2);
      e.exports = function (e, t, n) {
        return (
          r.forEach(n, function (n) {
            e = n(e, t);
          }),
          e
        );
      };
    },
    function (e, t) {
      "use strict";
      e.exports = function (e) {
        return !(!e || !e.__CANCEL__);
      };
    },
    function (e, t) {
      "use strict";
      e.exports = function (e) {
        return /^([a-z][a-z\d\+\-\.]*:)?\/\//i.test(e);
      };
    },
    function (e, t) {
      "use strict";
      e.exports = function (e, t) {
        return t ? e.replace(/\/+$/, "") + "/" + t.replace(/^\/+/, "") : e;
      };
    },
    function (e, t) {
      "use strict";
      function n(e) {
        this.message = e;
      }
      ((n.prototype.toString = function () {
        return "Cancel" + (this.message ? ": " + this.message : "");
      }),
        (n.prototype.__CANCEL__ = !0),
        (e.exports = n));
    },
    function (e, t, n) {
      "use strict";
      function r(e) {
        if ("function" != typeof e) throw new TypeError("executor must be a function.");
        var t;
        this.promise = new Promise(function (e) {
          t = e;
        });
        var n = this;
        e(function (e) {
          n.reason || ((n.reason = new o(e)), t(n.reason));
        });
      }
      var o = n(23);
      ((r.prototype.throwIfRequested = function () {
        if (this.reason) throw this.reason;
      }),
        (r.source = function () {
          var e,
            t = new r(function (t) {
              e = t;
            });
          return { token: t, cancel: e };
        }),
        (e.exports = r));
    },
    function (e, t) {
      "use strict";
      e.exports = function (e) {
        return function (t) {
          return e.apply(null, t);
        };
      };
    },
  ]);
});
!(function (e) {
  if ("object" == typeof exports && "undefined" != typeof module) module.exports = e();
  else if ("function" == typeof define && define.amd) define([], e);
  else {
    ("undefined" != typeof window
      ? window
      : "undefined" != typeof global
        ? global
        : "undefined" != typeof self
          ? self
          : this
    ).Qs = e();
  }
})(function () {
  return (function e(r, t, o) {
    function n(a, l) {
      if (!t[a]) {
        if (!r[a]) {
          var c = "function" == typeof require && require;
          if (!l && c) return c(a, !0);
          if (i) return i(a, !0);
          var f = new Error("Cannot find module '" + a + "'");
          throw ((f.code = "MODULE_NOT_FOUND"), f);
        }
        var s = (t[a] = { exports: {} });
        r[a][0].call(
          s.exports,
          function (e) {
            var t = r[a][1][e];
            return n(t || e);
          },
          s,
          s.exports,
          e,
          r,
          t,
          o,
        );
      }
      return t[a].exports;
    }
    for (var i = "function" == typeof require && require, a = 0; a < o.length; a++) n(o[a]);
    return n;
  })(
    {
      1: [
        function (e, r, t) {
          "use strict";
          var o = String.prototype.replace,
            n = /%20/g;
          r.exports = {
            default: "RFC3986",
            formatters: {
              RFC1738: function (e) {
                return o.call(e, n, "+");
              },
              RFC3986: function (e) {
                return e;
              },
            },
            RFC1738: "RFC1738",
            RFC3986: "RFC3986",
          };
        },
        {},
      ],
      2: [
        function (e, r, t) {
          "use strict";
          var o = e("./stringify"),
            n = e("./parse"),
            i = e("./formats");
          r.exports = { formats: i, parse: n, stringify: o };
        },
        { "./formats": 1, "./parse": 3, "./stringify": 4 },
      ],
      3: [
        function (e, r, t) {
          "use strict";
          var o = e("./utils"),
            n = Object.prototype.hasOwnProperty,
            i = {
              allowDots: !1,
              allowPrototypes: !1,
              arrayLimit: 20,
              decoder: o.decode,
              delimiter: "&",
              depth: 5,
              parameterLimit: 1e3,
              plainObjects: !1,
              strictNullHandling: !1,
            },
            a = function (e, r) {
              for (
                var t = {},
                  o = r.ignoreQueryPrefix ? e.replace(/^\?/, "") : e,
                  a = r.parameterLimit === 1 / 0 ? void 0 : r.parameterLimit,
                  l = o.split(r.delimiter, a),
                  c = 0;
                c < l.length;
                ++c
              ) {
                var f,
                  s,
                  u = l[c],
                  p = u.indexOf("]="),
                  d = -1 === p ? u.indexOf("=") : p + 1;
                (-1 === d
                  ? ((f = r.decoder(u, i.decoder)), (s = r.strictNullHandling ? null : ""))
                  : ((f = r.decoder(u.slice(0, d), i.decoder)), (s = r.decoder(u.slice(d + 1), i.decoder))),
                  n.call(t, f) ? (t[f] = [].concat(t[f]).concat(s)) : (t[f] = s));
              }
              return t;
            },
            l = function (e, r, t) {
              if (!e.length) return r;
              var o,
                n = e.shift();
              if ("[]" === n) o = (o = []).concat(l(e, r, t));
              else {
                o = t.plainObjects ? Object.create(null) : {};
                var i = "[" === n.charAt(0) && "]" === n.charAt(n.length - 1) ? n.slice(1, -1) : n,
                  a = parseInt(i, 10);
                !isNaN(a) && n !== i && String(a) === i && a >= 0 && t.parseArrays && a <= t.arrayLimit
                  ? ((o = [])[a] = l(e, r, t))
                  : (o[i] = l(e, r, t));
              }
              return o;
            },
            c = function (e, r, t) {
              if (e) {
                var o = t.allowDots ? e.replace(/\.([^.[]+)/g, "[$1]") : e,
                  i = /(\[[^[\]]*])/g,
                  a = /(\[[^[\]]*])/.exec(o),
                  c = a ? o.slice(0, a.index) : o,
                  f = [];
                if (c) {
                  if (!t.plainObjects && n.call(Object.prototype, c) && !t.allowPrototypes) return;
                  f.push(c);
                }
                for (var s = 0; null !== (a = i.exec(o)) && s < t.depth;) {
                  if (((s += 1), !t.plainObjects && n.call(Object.prototype, a[1].slice(1, -1)) && !t.allowPrototypes))
                    return;
                  f.push(a[1]);
                }
                return (a && f.push("[" + o.slice(a.index) + "]"), l(f, r, t));
              }
            };
          r.exports = function (e, r) {
            var t = r ? o.assign({}, r) : {};
            if (null !== t.decoder && void 0 !== t.decoder && "function" != typeof t.decoder)
              throw new TypeError("Decoder has to be a function.");
            if (
              ((t.ignoreQueryPrefix = !0 === t.ignoreQueryPrefix),
              (t.delimiter = "string" == typeof t.delimiter || o.isRegExp(t.delimiter) ? t.delimiter : i.delimiter),
              (t.depth = "number" == typeof t.depth ? t.depth : i.depth),
              (t.arrayLimit = "number" == typeof t.arrayLimit ? t.arrayLimit : i.arrayLimit),
              (t.parseArrays = !1 !== t.parseArrays),
              (t.decoder = "function" == typeof t.decoder ? t.decoder : i.decoder),
              (t.allowDots = "boolean" == typeof t.allowDots ? t.allowDots : i.allowDots),
              (t.plainObjects = "boolean" == typeof t.plainObjects ? t.plainObjects : i.plainObjects),
              (t.allowPrototypes = "boolean" == typeof t.allowPrototypes ? t.allowPrototypes : i.allowPrototypes),
              (t.parameterLimit = "number" == typeof t.parameterLimit ? t.parameterLimit : i.parameterLimit),
              (t.strictNullHandling =
                "boolean" == typeof t.strictNullHandling ? t.strictNullHandling : i.strictNullHandling),
              "" === e || null === e || void 0 === e)
            )
              return t.plainObjects ? Object.create(null) : {};
            for (
              var n = "string" == typeof e ? a(e, t) : e,
                l = t.plainObjects ? Object.create(null) : {},
                f = Object.keys(n),
                s = 0;
              s < f.length;
              ++s
            ) {
              var u = f[s],
                p = c(u, n[u], t);
              l = o.merge(l, p, t);
            }
            return o.compact(l);
          };
        },
        { "./utils": 5 },
      ],
      4: [
        function (e, r, t) {
          "use strict";
          var o = e("./utils"),
            n = e("./formats"),
            i = {
              brackets: function (e) {
                return e + "[]";
              },
              indices: function (e, r) {
                return e + "[" + r + "]";
              },
              repeat: function (e) {
                return e;
              },
            },
            a = Date.prototype.toISOString,
            l = {
              delimiter: "&",
              encode: !0,
              encoder: o.encode,
              encodeValuesOnly: !1,
              serializeDate: function (e) {
                return a.call(e);
              },
              skipNulls: !1,
              strictNullHandling: !1,
            },
            c = function e(r, t, n, i, a, c, f, s, u, p, d, y) {
              var m = r;
              if ("function" == typeof f) m = f(t, m);
              else if (m instanceof Date) m = p(m);
              else if (null === m) {
                if (i) return c && !y ? c(t, l.encoder) : t;
                m = "";
              }
              if ("string" == typeof m || "number" == typeof m || "boolean" == typeof m || o.isBuffer(m))
                return c ? [d(y ? t : c(t, l.encoder)) + "=" + d(c(m, l.encoder))] : [d(t) + "=" + d(String(m))];
              var b = [];
              if (void 0 === m) return b;
              var g;
              if (Array.isArray(f)) g = f;
              else {
                var v = Object.keys(m);
                g = s ? v.sort(s) : v;
              }
              for (var h = 0; h < g.length; ++h) {
                var O = g[h];
                (a && null === m[O]) ||
                  (b = Array.isArray(m)
                    ? b.concat(e(m[O], n(t, O), n, i, a, c, f, s, u, p, d, y))
                    : b.concat(e(m[O], t + (u ? "." + O : "[" + O + "]"), n, i, a, c, f, s, u, p, d, y)));
              }
              return b;
            };
          r.exports = function (e, r) {
            var t = e,
              a = r ? o.assign({}, r) : {};
            if (null !== a.encoder && void 0 !== a.encoder && "function" != typeof a.encoder)
              throw new TypeError("Encoder has to be a function.");
            var f = void 0 === a.delimiter ? l.delimiter : a.delimiter,
              s = "boolean" == typeof a.strictNullHandling ? a.strictNullHandling : l.strictNullHandling,
              u = "boolean" == typeof a.skipNulls ? a.skipNulls : l.skipNulls,
              p = "boolean" == typeof a.encode ? a.encode : l.encode,
              d = "function" == typeof a.encoder ? a.encoder : l.encoder,
              y = "function" == typeof a.sort ? a.sort : null,
              m = void 0 !== a.allowDots && a.allowDots,
              b = "function" == typeof a.serializeDate ? a.serializeDate : l.serializeDate,
              g = "boolean" == typeof a.encodeValuesOnly ? a.encodeValuesOnly : l.encodeValuesOnly;
            if (void 0 === a.format) a.format = n.default;
            else if (!Object.prototype.hasOwnProperty.call(n.formatters, a.format))
              throw new TypeError("Unknown format option provided.");
            var v,
              h,
              O = n.formatters[a.format];
            "function" == typeof a.filter ? (t = (h = a.filter)("", t)) : Array.isArray(a.filter) && (v = h = a.filter);
            var j = [];
            if ("object" != typeof t || null === t) return "";
            var w;
            w = a.arrayFormat in i ? a.arrayFormat : "indices" in a ? (a.indices ? "indices" : "repeat") : "indices";
            var A = i[w];
            (v || (v = Object.keys(t)), y && v.sort(y));
            for (var x = 0; x < v.length; ++x) {
              var N = v[x];
              (u && null === t[N]) || (j = j.concat(c(t[N], N, A, s, u, p ? d : null, h, y, m, b, O, g)));
            }
            var D = j.join(f),
              P = !0 === a.addQueryPrefix ? "?" : "";
            return D.length > 0 ? P + D : "";
          };
        },
        { "./formats": 1, "./utils": 5 },
      ],
      5: [
        function (e, r, t) {
          "use strict";
          var o = Object.prototype.hasOwnProperty,
            n = (function () {
              for (var e = [], r = 0; r < 256; ++r) e.push("%" + ((r < 16 ? "0" : "") + r.toString(16)).toUpperCase());
              return e;
            })();
          ((t.arrayToObject = function (e, r) {
            for (var t = r && r.plainObjects ? Object.create(null) : {}, o = 0; o < e.length; ++o)
              void 0 !== e[o] && (t[o] = e[o]);
            return t;
          }),
            (t.merge = function (e, r, n) {
              if (!r) return e;
              if ("object" != typeof r) {
                if (Array.isArray(e)) e.push(r);
                else {
                  if ("object" != typeof e) return [e, r];
                  (n.plainObjects || n.allowPrototypes || !o.call(Object.prototype, r)) && (e[r] = !0);
                }
                return e;
              }
              if ("object" != typeof e) return [e].concat(r);
              var i = e;
              return (
                Array.isArray(e) && !Array.isArray(r) && (i = t.arrayToObject(e, n)),
                Array.isArray(e) && Array.isArray(r)
                  ? (r.forEach(function (r, i) {
                      o.call(e, i)
                        ? e[i] && "object" == typeof e[i]
                          ? (e[i] = t.merge(e[i], r, n))
                          : e.push(r)
                        : (e[i] = r);
                    }),
                    e)
                  : Object.keys(r).reduce(function (e, i) {
                      var a = r[i];
                      return (o.call(e, i) ? (e[i] = t.merge(e[i], a, n)) : (e[i] = a), e);
                    }, i)
              );
            }),
            (t.assign = function (e, r) {
              return Object.keys(r).reduce(function (e, t) {
                return ((e[t] = r[t]), e);
              }, e);
            }),
            (t.decode = function (e) {
              try {
                return decodeURIComponent(e.replace(/\+/g, " "));
              } catch (r) {
                return e;
              }
            }),
            (t.encode = function (e) {
              if (0 === e.length) return e;
              for (var r = "string" == typeof e ? e : String(e), t = "", o = 0; o < r.length; ++o) {
                var i = r.charCodeAt(o);
                45 === i ||
                46 === i ||
                95 === i ||
                126 === i ||
                (i >= 48 && i <= 57) ||
                (i >= 65 && i <= 90) ||
                (i >= 97 && i <= 122)
                  ? (t += r.charAt(o))
                  : i < 128
                    ? (t += n[i])
                    : i < 2048
                      ? (t += n[192 | (i >> 6)] + n[128 | (63 & i)])
                      : i < 55296 || i >= 57344
                        ? (t += n[224 | (i >> 12)] + n[128 | ((i >> 6) & 63)] + n[128 | (63 & i)])
                        : ((o += 1),
                          (i = 65536 + (((1023 & i) << 10) | (1023 & r.charCodeAt(o)))),
                          (t +=
                            n[240 | (i >> 18)] +
                            n[128 | ((i >> 12) & 63)] +
                            n[128 | ((i >> 6) & 63)] +
                            n[128 | (63 & i)]));
              }
              return t;
            }),
            (t.compact = function (e, r) {
              if ("object" != typeof e || null === e) return e;
              var o = r || [],
                n = o.indexOf(e);
              if (-1 !== n) return o[n];
              if ((o.push(e), Array.isArray(e))) {
                for (var i = [], a = 0; a < e.length; ++a)
                  e[a] && "object" == typeof e[a] ? i.push(t.compact(e[a], o)) : void 0 !== e[a] && i.push(e[a]);
                return i;
              }
              return (
                Object.keys(e).forEach(function (r) {
                  e[r] = t.compact(e[r], o);
                }),
                e
              );
            }),
            (t.isRegExp = function (e) {
              return "[object RegExp]" === Object.prototype.toString.call(e);
            }),
            (t.isBuffer = function (e) {
              return (
                null !== e && void 0 !== e && !!(e.constructor && e.constructor.isBuffer && e.constructor.isBuffer(e))
              );
            }));
        },
        {},
      ],
    },
    {},
    [2],
  )(2);
});
/*!
 * Flickity PACKAGED v2.2.1
 * Touch, responsive, flickable carousels
 *
 * Licensed GPLv3 for open source use
 * or Flickity Commercial License for commercial use
 *
 * https://flickity.metafizzy.co
 * Copyright 2015-2019 Metafizzy
 */
(!(function (e, i) {
  "function" == typeof define && define.amd
    ? define("jquery-bridget/jquery-bridget", ["jquery"], function (t) {
        return i(e, t);
      })
    : "object" == typeof module && module.exports
      ? (module.exports = i(e, require("jquery")))
      : (e.jQueryBridget = i(e, e.jQuery));
})(window, function (t, e) {
  "use strict";
  var i = Array.prototype.slice,
    n = t.console,
    d =
      void 0 === n
        ? function () {}
        : function (t) {
            n.error(t);
          };
  function s(h, s, c) {
    (c = c || e || t.jQuery) &&
      (s.prototype.option ||
        (s.prototype.option = function (t) {
          c.isPlainObject(t) && (this.options = c.extend(!0, this.options, t));
        }),
      (c.fn[h] = function (t) {
        return "string" == typeof t
          ? (function (t, o, r) {
              var a,
                l = "$()." + h + '("' + o + '")';
              return (
                t.each(function (t, e) {
                  var i = c.data(e, h);
                  if (i) {
                    var n = i[o];
                    if (n && "_" != o.charAt(0)) {
                      var s = n.apply(i, r);
                      a = void 0 === a ? s : a;
                    } else d(l + " is not a valid method");
                  } else d(h + " not initialized. Cannot call methods, i.e. " + l);
                }),
                void 0 !== a ? a : t
              );
            })(this, t, i.call(arguments, 1))
          : ((function (t, n) {
              t.each(function (t, e) {
                var i = c.data(e, h);
                i ? (i.option(n), i._init()) : ((i = new s(e, n)), c.data(e, h, i));
              });
            })(this, t),
            this);
      }),
      o(c));
  }
  function o(t) {
    !t || (t && t.bridget) || (t.bridget = s);
  }
  return (o(e || t.jQuery), s);
}),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define("ev-emitter/ev-emitter", e)
      : "object" == typeof module && module.exports
        ? (module.exports = e())
        : (t.EvEmitter = e());
  })("undefined" != typeof window ? window : this, function () {
    function t() {}
    var e = t.prototype;
    return (
      (e.on = function (t, e) {
        if (t && e) {
          var i = (this._events = this._events || {}),
            n = (i[t] = i[t] || []);
          return (-1 == n.indexOf(e) && n.push(e), this);
        }
      }),
      (e.once = function (t, e) {
        if (t && e) {
          this.on(t, e);
          var i = (this._onceEvents = this._onceEvents || {});
          return (((i[t] = i[t] || {})[e] = !0), this);
        }
      }),
      (e.off = function (t, e) {
        var i = this._events && this._events[t];
        if (i && i.length) {
          var n = i.indexOf(e);
          return (-1 != n && i.splice(n, 1), this);
        }
      }),
      (e.emitEvent = function (t, e) {
        var i = this._events && this._events[t];
        if (i && i.length) {
          ((i = i.slice(0)), (e = e || []));
          for (var n = this._onceEvents && this._onceEvents[t], s = 0; s < i.length; s++) {
            var o = i[s];
            (n && n[o] && (this.off(t, o), delete n[o]), o.apply(this, e));
          }
          return this;
        }
      }),
      (e.allOff = function () {
        (delete this._events, delete this._onceEvents);
      }),
      t
    );
  }),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define("get-size/get-size", e)
      : "object" == typeof module && module.exports
        ? (module.exports = e())
        : (t.getSize = e());
  })(window, function () {
    "use strict";
    function m(t) {
      var e = parseFloat(t);
      return -1 == t.indexOf("%") && !isNaN(e) && e;
    }
    var i =
        "undefined" == typeof console
          ? function () {}
          : function (t) {
              console.error(t);
            },
      y = [
        "paddingLeft",
        "paddingRight",
        "paddingTop",
        "paddingBottom",
        "marginLeft",
        "marginRight",
        "marginTop",
        "marginBottom",
        "borderLeftWidth",
        "borderRightWidth",
        "borderTopWidth",
        "borderBottomWidth",
      ],
      b = y.length;
    function E(t) {
      var e = getComputedStyle(t);
      return (
        e ||
          i(
            "Style returned " +
              e +
              ". Are you running this code in a hidden iframe on Firefox? See https://bit.ly/getsizebug1",
          ),
        e
      );
    }
    var S,
      C = !1;
    function x(t) {
      if (
        ((function () {
          if (!C) {
            C = !0;
            var t = document.createElement("div");
            ((t.style.width = "200px"),
              (t.style.padding = "1px 2px 3px 4px"),
              (t.style.borderStyle = "solid"),
              (t.style.borderWidth = "1px 2px 3px 4px"),
              (t.style.boxSizing = "border-box"));
            var e = document.body || document.documentElement;
            e.appendChild(t);
            var i = E(t);
            ((S = 200 == Math.round(m(i.width))), (x.isBoxSizeOuter = S), e.removeChild(t));
          }
        })(),
        "string" == typeof t && (t = document.querySelector(t)),
        t && "object" == typeof t && t.nodeType)
      ) {
        var e = E(t);
        if ("none" == e.display)
          return (function () {
            for (
              var t = { width: 0, height: 0, innerWidth: 0, innerHeight: 0, outerWidth: 0, outerHeight: 0 }, e = 0;
              e < b;
              e++
            ) {
              t[y[e]] = 0;
            }
            return t;
          })();
        var i = {};
        ((i.width = t.offsetWidth), (i.height = t.offsetHeight));
        for (var n = (i.isBorderBox = "border-box" == e.boxSizing), s = 0; s < b; s++) {
          var o = y[s],
            r = e[o],
            a = parseFloat(r);
          i[o] = isNaN(a) ? 0 : a;
        }
        var l = i.paddingLeft + i.paddingRight,
          h = i.paddingTop + i.paddingBottom,
          c = i.marginLeft + i.marginRight,
          d = i.marginTop + i.marginBottom,
          u = i.borderLeftWidth + i.borderRightWidth,
          f = i.borderTopWidth + i.borderBottomWidth,
          p = n && S,
          g = m(e.width);
        !1 !== g && (i.width = g + (p ? 0 : l + u));
        var v = m(e.height);
        return (
          !1 !== v && (i.height = v + (p ? 0 : h + f)),
          (i.innerWidth = i.width - (l + u)),
          (i.innerHeight = i.height - (h + f)),
          (i.outerWidth = i.width + c),
          (i.outerHeight = i.height + d),
          i
        );
      }
    }
    return x;
  }),
  (function (t, e) {
    "use strict";
    "function" == typeof define && define.amd
      ? define("desandro-matches-selector/matches-selector", e)
      : "object" == typeof module && module.exports
        ? (module.exports = e())
        : (t.matchesSelector = e());
  })(window, function () {
    "use strict";
    var i = (function () {
      var t = window.Element.prototype;
      if (t.matches) return "matches";
      if (t.matchesSelector) return "matchesSelector";
      for (var e = ["webkit", "moz", "ms", "o"], i = 0; i < e.length; i++) {
        var n = e[i] + "MatchesSelector";
        if (t[n]) return n;
      }
    })();
    return function (t, e) {
      return t[i](e);
    };
  }),
  (function (e, i) {
    "function" == typeof define && define.amd
      ? define("fizzy-ui-utils/utils", ["desandro-matches-selector/matches-selector"], function (t) {
          return i(e, t);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = i(e, require("desandro-matches-selector")))
        : (e.fizzyUIUtils = i(e, e.matchesSelector));
  })(window, function (h, o) {
    var c = {
        extend: function (t, e) {
          for (var i in e) t[i] = e[i];
          return t;
        },
        modulo: function (t, e) {
          return ((t % e) + e) % e;
        },
      },
      e = Array.prototype.slice;
    ((c.makeArray = function (t) {
      return Array.isArray(t)
        ? t
        : null == t
          ? []
          : "object" == typeof t && "number" == typeof t.length
            ? e.call(t)
            : [t];
    }),
      (c.removeFrom = function (t, e) {
        var i = t.indexOf(e);
        -1 != i && t.splice(i, 1);
      }),
      (c.getParent = function (t, e) {
        for (; t.parentNode && t != document.body;) if (((t = t.parentNode), o(t, e))) return t;
      }),
      (c.getQueryElement = function (t) {
        return "string" == typeof t ? document.querySelector(t) : t;
      }),
      (c.handleEvent = function (t) {
        var e = "on" + t.type;
        this[e] && this[e](t);
      }),
      (c.filterFindElements = function (t, n) {
        t = c.makeArray(t);
        var s = [];
        return (
          t.forEach(function (t) {
            if (t instanceof HTMLElement)
              if (n) {
                o(t, n) && s.push(t);
                for (var e = t.querySelectorAll(n), i = 0; i < e.length; i++) s.push(e[i]);
              } else s.push(t);
          }),
          s
        );
      }),
      (c.debounceMethod = function (t, e, n) {
        n = n || 100;
        var s = t.prototype[e],
          o = e + "Timeout";
        t.prototype[e] = function () {
          var t = this[o];
          clearTimeout(t);
          var e = arguments,
            i = this;
          this[o] = setTimeout(function () {
            (s.apply(i, e), delete i[o]);
          }, n);
        };
      }),
      (c.docReady = function (t) {
        var e = document.readyState;
        "complete" == e || "interactive" == e ? setTimeout(t) : document.addEventListener("DOMContentLoaded", t);
      }),
      (c.toDashed = function (t) {
        return t
          .replace(/(.)([A-Z])/g, function (t, e, i) {
            return e + "-" + i;
          })
          .toLowerCase();
      }));
    var d = h.console;
    return (
      (c.htmlInit = function (a, l) {
        c.docReady(function () {
          var t = c.toDashed(l),
            s = "data-" + t,
            e = document.querySelectorAll("[" + s + "]"),
            i = document.querySelectorAll(".js-" + t),
            n = c.makeArray(e).concat(c.makeArray(i)),
            o = s + "-options",
            r = h.jQuery;
          n.forEach(function (e) {
            var t,
              i = e.getAttribute(s) || e.getAttribute(o);
            try {
              t = i && JSON.parse(i);
            } catch (t) {
              return void (d && d.error("Error parsing " + s + " on " + e.className + ": " + t));
            }
            var n = new a(e, t);
            r && r.data(e, l, n);
          });
        });
      }),
      c
    );
  }),
  (function (e, i) {
    "function" == typeof define && define.amd
      ? define("flickity/js/cell", ["get-size/get-size"], function (t) {
          return i(e, t);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = i(e, require("get-size")))
        : ((e.Flickity = e.Flickity || {}), (e.Flickity.Cell = i(e, e.getSize)));
  })(window, function (t, e) {
    function i(t, e) {
      ((this.element = t), (this.parent = e), this.create());
    }
    var n = i.prototype;
    return (
      (n.create = function () {
        ((this.element.style.position = "absolute"),
          this.element.setAttribute("aria-hidden", "true"),
          (this.x = 0),
          (this.shift = 0));
      }),
      (n.destroy = function () {
        (this.unselect(), (this.element.style.position = ""));
        var t = this.parent.originSide;
        this.element.style[t] = "";
      }),
      (n.getSize = function () {
        this.size = e(this.element);
      }),
      (n.setPosition = function (t) {
        ((this.x = t), this.updateTarget(), this.renderPosition(t));
      }),
      (n.updateTarget = n.setDefaultTarget =
        function () {
          var t = "left" == this.parent.originSide ? "marginLeft" : "marginRight";
          this.target = this.x + this.size[t] + this.size.width * this.parent.cellAlign;
        }),
      (n.renderPosition = function (t) {
        var e = this.parent.originSide;
        this.element.style[e] = this.parent.getPositionValue(t);
      }),
      (n.select = function () {
        (this.element.classList.add("is-selected"), this.element.removeAttribute("aria-hidden"));
      }),
      (n.unselect = function () {
        (this.element.classList.remove("is-selected"), this.element.setAttribute("aria-hidden", "true"));
      }),
      (n.wrapShift = function (t) {
        ((this.shift = t), this.renderPosition(this.x + this.parent.slideableWidth * t));
      }),
      (n.remove = function () {
        this.element.parentNode.removeChild(this.element);
      }),
      i
    );
  }),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define("flickity/js/slide", e)
      : "object" == typeof module && module.exports
        ? (module.exports = e())
        : ((t.Flickity = t.Flickity || {}), (t.Flickity.Slide = e()));
  })(window, function () {
    "use strict";
    function t(t) {
      ((this.parent = t),
        (this.isOriginLeft = "left" == t.originSide),
        (this.cells = []),
        (this.outerWidth = 0),
        (this.height = 0));
    }
    var e = t.prototype;
    return (
      (e.addCell = function (t) {
        if (
          (this.cells.push(t),
          (this.outerWidth += t.size.outerWidth),
          (this.height = Math.max(t.size.outerHeight, this.height)),
          1 == this.cells.length)
        ) {
          this.x = t.x;
          var e = this.isOriginLeft ? "marginLeft" : "marginRight";
          this.firstMargin = t.size[e];
        }
      }),
      (e.updateTarget = function () {
        var t = this.isOriginLeft ? "marginRight" : "marginLeft",
          e = this.getLastCell(),
          i = e ? e.size[t] : 0,
          n = this.outerWidth - (this.firstMargin + i);
        this.target = this.x + this.firstMargin + n * this.parent.cellAlign;
      }),
      (e.getLastCell = function () {
        return this.cells[this.cells.length - 1];
      }),
      (e.select = function () {
        this.cells.forEach(function (t) {
          t.select();
        });
      }),
      (e.unselect = function () {
        this.cells.forEach(function (t) {
          t.unselect();
        });
      }),
      (e.getCellElements = function () {
        return this.cells.map(function (t) {
          return t.element;
        });
      }),
      t
    );
  }),
  (function (e, i) {
    "function" == typeof define && define.amd
      ? define("flickity/js/animate", ["fizzy-ui-utils/utils"], function (t) {
          return i(e, t);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = i(e, require("fizzy-ui-utils")))
        : ((e.Flickity = e.Flickity || {}), (e.Flickity.animatePrototype = i(e, e.fizzyUIUtils)));
  })(window, function (t, e) {
    var i = {
      startAnimation: function () {
        this.isAnimating || ((this.isAnimating = !0), (this.restingFrames = 0), this.animate());
      },
      animate: function () {
        (this.applyDragForce(), this.applySelectedAttraction());
        var t = this.x;
        if ((this.integratePhysics(), this.positionSlider(), this.settle(t), this.isAnimating)) {
          var e = this;
          requestAnimationFrame(function () {
            e.animate();
          });
        }
      },
      positionSlider: function () {
        var t = this.x;
        (this.options.wrapAround &&
          1 < this.cells.length &&
          ((t = e.modulo(t, this.slideableWidth)), (t -= this.slideableWidth), this.shiftWrapCells(t)),
          this.setTranslateX(t, this.isAnimating),
          this.dispatchScrollEvent());
      },
      setTranslateX: function (t, e) {
        ((t += this.cursorPosition), (t = this.options.rightToLeft ? -t : t));
        var i = this.getPositionValue(t);
        this.slider.style.transform = e ? "translate3d(" + i + ",0,0)" : "translateX(" + i + ")";
      },
      dispatchScrollEvent: function () {
        var t = this.slides[0];
        if (t) {
          var e = -this.x - t.target,
            i = e / this.slidesWidth;
          this.dispatchEvent("scroll", null, [i, e]);
        }
      },
      positionSliderAtSelected: function () {
        this.cells.length && ((this.x = -this.selectedSlide.target), (this.velocity = 0), this.positionSlider());
      },
      getPositionValue: function (t) {
        return this.options.percentPosition
          ? 0.01 * Math.round((t / this.size.innerWidth) * 1e4) + "%"
          : Math.round(t) + "px";
      },
      settle: function (t) {
        (this.isPointerDown || Math.round(100 * this.x) != Math.round(100 * t) || this.restingFrames++,
          2 < this.restingFrames &&
            ((this.isAnimating = !1),
            delete this.isFreeScrolling,
            this.positionSlider(),
            this.dispatchEvent("settle", null, [this.selectedIndex])));
      },
      shiftWrapCells: function (t) {
        var e = this.cursorPosition + t;
        this._shiftCells(this.beforeShiftCells, e, -1);
        var i = this.size.innerWidth - (t + this.slideableWidth + this.cursorPosition);
        this._shiftCells(this.afterShiftCells, i, 1);
      },
      _shiftCells: function (t, e, i) {
        for (var n = 0; n < t.length; n++) {
          var s = t[n],
            o = 0 < e ? i : 0;
          (s.wrapShift(o), (e -= s.size.outerWidth));
        }
      },
      _unshiftCells: function (t) {
        if (t && t.length) for (var e = 0; e < t.length; e++) t[e].wrapShift(0);
      },
      integratePhysics: function () {
        ((this.x += this.velocity), (this.velocity *= this.getFrictionFactor()));
      },
      applyForce: function (t) {
        this.velocity += t;
      },
      getFrictionFactor: function () {
        return 1 - this.options[this.isFreeScrolling ? "freeScrollFriction" : "friction"];
      },
      getRestingPosition: function () {
        return this.x + this.velocity / (1 - this.getFrictionFactor());
      },
      applyDragForce: function () {
        if (this.isDraggable && this.isPointerDown) {
          var t = this.dragX - this.x - this.velocity;
          this.applyForce(t);
        }
      },
      applySelectedAttraction: function () {
        if (!(this.isDraggable && this.isPointerDown) && !this.isFreeScrolling && this.slides.length) {
          var t = (-1 * this.selectedSlide.target - this.x) * this.options.selectedAttraction;
          this.applyForce(t);
        }
      },
    };
    return i;
  }),
  (function (r, a) {
    if ("function" == typeof define && define.amd)
      define("flickity/js/flickity", [
        "ev-emitter/ev-emitter",
        "get-size/get-size",
        "fizzy-ui-utils/utils",
        "./cell",
        "./slide",
        "./animate",
      ], function (t, e, i, n, s, o) {
        return a(r, t, e, i, n, s, o);
      });
    else if ("object" == typeof module && module.exports)
      module.exports = a(
        r,
        require("ev-emitter"),
        require("get-size"),
        require("fizzy-ui-utils"),
        require("./cell"),
        require("./slide"),
        require("./animate"),
      );
    else {
      var t = r.Flickity;
      r.Flickity = a(r, r.EvEmitter, r.getSize, r.fizzyUIUtils, t.Cell, t.Slide, t.animatePrototype);
    }
  })(window, function (n, t, e, a, i, r, s) {
    var l = n.jQuery,
      o = n.getComputedStyle,
      h = n.console;
    function c(t, e) {
      for (t = a.makeArray(t); t.length;) e.appendChild(t.shift());
    }
    var d = 0,
      u = {};
    function f(t, e) {
      var i = a.getQueryElement(t);
      if (i) {
        if (((this.element = i), this.element.flickityGUID)) {
          var n = u[this.element.flickityGUID];
          return (n.option(e), n);
        }
        (l && (this.$element = l(this.element)),
          (this.options = a.extend({}, this.constructor.defaults)),
          this.option(e),
          this._create());
      } else h && h.error("Bad element for Flickity: " + (i || t));
    }
    ((f.defaults = {
      accessibility: !0,
      cellAlign: "center",
      freeScrollFriction: 0.075,
      friction: 0.28,
      namespaceJQueryEvents: !0,
      percentPosition: !0,
      resize: !0,
      selectedAttraction: 0.025,
      setGallerySize: !0,
    }),
      (f.createMethods = []));
    var p = f.prototype;
    (a.extend(p, t.prototype),
      (p._create = function () {
        var t = (this.guid = ++d);
        for (var e in ((this.element.flickityGUID = t),
        ((u[t] = this).selectedIndex = 0),
        (this.restingFrames = 0),
        (this.x = 0),
        (this.velocity = 0),
        (this.originSide = this.options.rightToLeft ? "right" : "left"),
        (this.viewport = document.createElement("div")),
        (this.viewport.className = "flickity-viewport"),
        this._createSlider(),
        (this.options.resize || this.options.watchCSS) && n.addEventListener("resize", this),
        this.options.on)) {
          var i = this.options.on[e];
          this.on(e, i);
        }
        (f.createMethods.forEach(function (t) {
          this[t]();
        }, this),
          this.options.watchCSS ? this.watchCSS() : this.activate());
      }),
      (p.option = function (t) {
        a.extend(this.options, t);
      }),
      (p.activate = function () {
        this.isActive ||
          ((this.isActive = !0),
          this.element.classList.add("flickity-enabled"),
          this.options.rightToLeft && this.element.classList.add("flickity-rtl"),
          this.getSize(),
          c(this._filterFindCellElements(this.element.children), this.slider),
          this.viewport.appendChild(this.slider),
          this.element.appendChild(this.viewport),
          this.reloadCells(),
          this.options.accessibility && ((this.element.tabIndex = 0), this.element.addEventListener("keydown", this)),
          this.emitEvent("activate"),
          this.selectInitialIndex(),
          (this.isInitActivated = !0),
          this.dispatchEvent("ready"));
      }),
      (p._createSlider = function () {
        var t = document.createElement("div");
        ((t.className = "flickity-slider"), (t.style[this.originSide] = 0), (this.slider = t));
      }),
      (p._filterFindCellElements = function (t) {
        return a.filterFindElements(t, this.options.cellSelector);
      }),
      (p.reloadCells = function () {
        ((this.cells = this._makeCells(this.slider.children)),
          this.positionCells(),
          this._getWrapShiftCells(),
          this.setGallerySize());
      }),
      (p._makeCells = function (t) {
        return this._filterFindCellElements(t).map(function (t) {
          return new i(t, this);
        }, this);
      }),
      (p.getLastCell = function () {
        return this.cells[this.cells.length - 1];
      }),
      (p.getLastSlide = function () {
        return this.slides[this.slides.length - 1];
      }),
      (p.positionCells = function () {
        (this._sizeCells(this.cells), this._positionCells(0));
      }),
      (p._positionCells = function (t) {
        ((t = t || 0), (this.maxCellHeight = (t && this.maxCellHeight) || 0));
        var e = 0;
        if (0 < t) {
          var i = this.cells[t - 1];
          e = i.x + i.size.outerWidth;
        }
        for (var n = this.cells.length, s = t; s < n; s++) {
          var o = this.cells[s];
          (o.setPosition(e),
            (e += o.size.outerWidth),
            (this.maxCellHeight = Math.max(o.size.outerHeight, this.maxCellHeight)));
        }
        ((this.slideableWidth = e),
          this.updateSlides(),
          this._containSlides(),
          (this.slidesWidth = n ? this.getLastSlide().target - this.slides[0].target : 0));
      }),
      (p._sizeCells = function (t) {
        t.forEach(function (t) {
          t.getSize();
        });
      }),
      (p.updateSlides = function () {
        if (((this.slides = []), this.cells.length)) {
          var n = new r(this);
          this.slides.push(n);
          var s = "left" == this.originSide ? "marginRight" : "marginLeft",
            o = this._getCanCellFit();
          (this.cells.forEach(function (t, e) {
            if (n.cells.length) {
              var i = n.outerWidth - n.firstMargin + (t.size.outerWidth - t.size[s]);
              (o.call(this, e, i) || (n.updateTarget(), (n = new r(this)), this.slides.push(n)), n.addCell(t));
            } else n.addCell(t);
          }, this),
            n.updateTarget(),
            this.updateSelectedSlide());
        }
      }),
      (p._getCanCellFit = function () {
        var t = this.options.groupCells;
        if (!t)
          return function () {
            return !1;
          };
        if ("number" == typeof t) {
          var e = parseInt(t, 10);
          return function (t) {
            return t % e != 0;
          };
        }
        var i = "string" == typeof t && t.match(/^(\d+)%$/),
          n = i ? parseInt(i[1], 10) / 100 : 1;
        return function (t, e) {
          return e <= (this.size.innerWidth + 1) * n;
        };
      }),
      (p._init = p.reposition =
        function () {
          (this.positionCells(), this.positionSliderAtSelected());
        }),
      (p.getSize = function () {
        ((this.size = e(this.element)),
          this.setCellAlign(),
          (this.cursorPosition = this.size.innerWidth * this.cellAlign));
      }));
    var g = { center: { left: 0.5, right: 0.5 }, left: { left: 0, right: 1 }, right: { right: 0, left: 1 } };
    return (
      (p.setCellAlign = function () {
        var t = g[this.options.cellAlign];
        this.cellAlign = t ? t[this.originSide] : this.options.cellAlign;
      }),
      (p.setGallerySize = function () {
        if (this.options.setGallerySize) {
          var t = this.options.adaptiveHeight && this.selectedSlide ? this.selectedSlide.height : this.maxCellHeight;
          this.viewport.style.height = t + "px";
        }
      }),
      (p._getWrapShiftCells = function () {
        if (this.options.wrapAround) {
          (this._unshiftCells(this.beforeShiftCells), this._unshiftCells(this.afterShiftCells));
          var t = this.cursorPosition,
            e = this.cells.length - 1;
          ((this.beforeShiftCells = this._getGapCells(t, e, -1)),
            (t = this.size.innerWidth - this.cursorPosition),
            (this.afterShiftCells = this._getGapCells(t, 0, 1)));
        }
      }),
      (p._getGapCells = function (t, e, i) {
        for (var n = []; 0 < t;) {
          var s = this.cells[e];
          if (!s) break;
          (n.push(s), (e += i), (t -= s.size.outerWidth));
        }
        return n;
      }),
      (p._containSlides = function () {
        if (this.options.contain && !this.options.wrapAround && this.cells.length) {
          var t = this.options.rightToLeft,
            e = t ? "marginRight" : "marginLeft",
            i = t ? "marginLeft" : "marginRight",
            n = this.slideableWidth - this.getLastCell().size[i],
            s = n < this.size.innerWidth,
            o = this.cursorPosition + this.cells[0].size[e],
            r = n - this.size.innerWidth * (1 - this.cellAlign);
          this.slides.forEach(function (t) {
            s
              ? (t.target = n * this.cellAlign)
              : ((t.target = Math.max(t.target, o)), (t.target = Math.min(t.target, r)));
          }, this);
        }
      }),
      (p.dispatchEvent = function (t, e, i) {
        var n = e ? [e].concat(i) : i;
        if ((this.emitEvent(t, n), l && this.$element)) {
          var s = (t += this.options.namespaceJQueryEvents ? ".flickity" : "");
          if (e) {
            var o = l.Event(e);
            ((o.type = t), (s = o));
          }
          this.$element.trigger(s, i);
        }
      }),
      (p.select = function (t, e, i) {
        if (
          this.isActive &&
          ((t = parseInt(t, 10)),
          this._wrapSelect(t),
          (this.options.wrapAround || e) && (t = a.modulo(t, this.slides.length)),
          this.slides[t])
        ) {
          var n = this.selectedIndex;
          ((this.selectedIndex = t),
            this.updateSelectedSlide(),
            i ? this.positionSliderAtSelected() : this.startAnimation(),
            this.options.adaptiveHeight && this.setGallerySize(),
            this.dispatchEvent("select", null, [t]),
            t != n && this.dispatchEvent("change", null, [t]),
            this.dispatchEvent("cellSelect"));
        }
      }),
      (p._wrapSelect = function (t) {
        var e = this.slides.length;
        if (!(this.options.wrapAround && 1 < e)) return t;
        var i = a.modulo(t, e),
          n = Math.abs(i - this.selectedIndex),
          s = Math.abs(i + e - this.selectedIndex),
          o = Math.abs(i - e - this.selectedIndex);
        (!this.isDragSelect && s < n ? (t += e) : !this.isDragSelect && o < n && (t -= e),
          t < 0 ? (this.x -= this.slideableWidth) : e <= t && (this.x += this.slideableWidth));
      }),
      (p.previous = function (t, e) {
        this.select(this.selectedIndex - 1, t, e);
      }),
      (p.next = function (t, e) {
        this.select(this.selectedIndex + 1, t, e);
      }),
      (p.updateSelectedSlide = function () {
        var t = this.slides[this.selectedIndex];
        t &&
          (this.unselectSelectedSlide(),
          (this.selectedSlide = t).select(),
          (this.selectedCells = t.cells),
          (this.selectedElements = t.getCellElements()),
          (this.selectedCell = t.cells[0]),
          (this.selectedElement = this.selectedElements[0]));
      }),
      (p.unselectSelectedSlide = function () {
        this.selectedSlide && this.selectedSlide.unselect();
      }),
      (p.selectInitialIndex = function () {
        var t = this.options.initialIndex;
        if (this.isInitActivated) this.select(this.selectedIndex, !1, !0);
        else {
          if (t && "string" == typeof t) if (this.queryCell(t)) return void this.selectCell(t, !1, !0);
          var e = 0;
          (t && this.slides[t] && (e = t), this.select(e, !1, !0));
        }
      }),
      (p.selectCell = function (t, e, i) {
        var n = this.queryCell(t);
        if (n) {
          var s = this.getCellSlideIndex(n);
          this.select(s, e, i);
        }
      }),
      (p.getCellSlideIndex = function (t) {
        for (var e = 0; e < this.slides.length; e++) {
          if (-1 != this.slides[e].cells.indexOf(t)) return e;
        }
      }),
      (p.getCell = function (t) {
        for (var e = 0; e < this.cells.length; e++) {
          var i = this.cells[e];
          if (i.element == t) return i;
        }
      }),
      (p.getCells = function (t) {
        t = a.makeArray(t);
        var i = [];
        return (
          t.forEach(function (t) {
            var e = this.getCell(t);
            e && i.push(e);
          }, this),
          i
        );
      }),
      (p.getCellElements = function () {
        return this.cells.map(function (t) {
          return t.element;
        });
      }),
      (p.getParentCell = function (t) {
        var e = this.getCell(t);
        return e || ((t = a.getParent(t, ".flickity-slider > *")), this.getCell(t));
      }),
      (p.getAdjacentCellElements = function (t, e) {
        if (!t) return this.selectedSlide.getCellElements();
        e = void 0 === e ? this.selectedIndex : e;
        var i = this.slides.length;
        if (i <= 1 + 2 * t) return this.getCellElements();
        for (var n = [], s = e - t; s <= e + t; s++) {
          var o = this.options.wrapAround ? a.modulo(s, i) : s,
            r = this.slides[o];
          r && (n = n.concat(r.getCellElements()));
        }
        return n;
      }),
      (p.queryCell = function (t) {
        if ("number" == typeof t) return this.cells[t];
        if ("string" == typeof t) {
          if (t.match(/^[#\.]?[\d\/]/)) return;
          t = this.element.querySelector(t);
        }
        return this.getCell(t);
      }),
      (p.uiChange = function () {
        this.emitEvent("uiChange");
      }),
      (p.childUIPointerDown = function (t) {
        ("touchstart" != t.type && t.preventDefault(), this.focus());
      }),
      (p.onresize = function () {
        (this.watchCSS(), this.resize());
      }),
      a.debounceMethod(f, "onresize", 150),
      (p.resize = function () {
        if (this.isActive) {
          (this.getSize(),
            this.options.wrapAround && (this.x = a.modulo(this.x, this.slideableWidth)),
            this.positionCells(),
            this._getWrapShiftCells(),
            this.setGallerySize(),
            this.emitEvent("resize"));
          var t = this.selectedElements && this.selectedElements[0];
          this.selectCell(t, !1, !0);
        }
      }),
      (p.watchCSS = function () {
        this.options.watchCSS &&
          (-1 != o(this.element, ":after").content.indexOf("flickity") ? this.activate() : this.deactivate());
      }),
      (p.onkeydown = function (t) {
        var e = document.activeElement && document.activeElement != this.element;
        if (this.options.accessibility && !e) {
          var i = f.keyboardHandlers[t.keyCode];
          i && i.call(this);
        }
      }),
      (f.keyboardHandlers = {
        37: function () {
          var t = this.options.rightToLeft ? "next" : "previous";
          (this.uiChange(), this[t]());
        },
        39: function () {
          var t = this.options.rightToLeft ? "previous" : "next";
          (this.uiChange(), this[t]());
        },
      }),
      (p.focus = function () {
        var t = n.pageYOffset;
        (this.element.focus({ preventScroll: !0 }), n.pageYOffset != t && n.scrollTo(n.pageXOffset, t));
      }),
      (p.deactivate = function () {
        this.isActive &&
          (this.element.classList.remove("flickity-enabled"),
          this.element.classList.remove("flickity-rtl"),
          this.unselectSelectedSlide(),
          this.cells.forEach(function (t) {
            t.destroy();
          }),
          this.element.removeChild(this.viewport),
          c(this.slider.children, this.element),
          this.options.accessibility &&
            (this.element.removeAttribute("tabIndex"), this.element.removeEventListener("keydown", this)),
          (this.isActive = !1),
          this.emitEvent("deactivate"));
      }),
      (p.destroy = function () {
        (this.deactivate(),
          n.removeEventListener("resize", this),
          this.allOff(),
          this.emitEvent("destroy"),
          l && this.$element && l.removeData(this.element, "flickity"),
          delete this.element.flickityGUID,
          delete u[this.guid]);
      }),
      a.extend(p, s),
      (f.data = function (t) {
        var e = (t = a.getQueryElement(t)) && t.flickityGUID;
        return e && u[e];
      }),
      a.htmlInit(f, "flickity"),
      l && l.bridget && l.bridget("flickity", f),
      (f.setJQuery = function (t) {
        l = t;
      }),
      (f.Cell = i),
      (f.Slide = r),
      f
    );
  }),
  (function (e, i) {
    "function" == typeof define && define.amd
      ? define("unipointer/unipointer", ["ev-emitter/ev-emitter"], function (t) {
          return i(e, t);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = i(e, require("ev-emitter")))
        : (e.Unipointer = i(e, e.EvEmitter));
  })(window, function (s, t) {
    function e() {}
    var i = (e.prototype = Object.create(t.prototype));
    ((i.bindStartEvent = function (t) {
      this._bindStartEvent(t, !0);
    }),
      (i.unbindStartEvent = function (t) {
        this._bindStartEvent(t, !1);
      }),
      (i._bindStartEvent = function (t, e) {
        var i = (e = void 0 === e || e) ? "addEventListener" : "removeEventListener",
          n = "mousedown";
        (s.PointerEvent ? (n = "pointerdown") : "ontouchstart" in s && (n = "touchstart"), t[i](n, this));
      }),
      (i.handleEvent = function (t) {
        var e = "on" + t.type;
        this[e] && this[e](t);
      }),
      (i.getTouch = function (t) {
        for (var e = 0; e < t.length; e++) {
          var i = t[e];
          if (i.identifier == this.pointerIdentifier) return i;
        }
      }),
      (i.onmousedown = function (t) {
        var e = t.button;
        (e && 0 !== e && 1 !== e) || this._pointerDown(t, t);
      }),
      (i.ontouchstart = function (t) {
        this._pointerDown(t, t.changedTouches[0]);
      }),
      (i.onpointerdown = function (t) {
        this._pointerDown(t, t);
      }),
      (i._pointerDown = function (t, e) {
        t.button ||
          this.isPointerDown ||
          ((this.isPointerDown = !0),
          (this.pointerIdentifier = void 0 !== e.pointerId ? e.pointerId : e.identifier),
          this.pointerDown(t, e));
      }),
      (i.pointerDown = function (t, e) {
        (this._bindPostStartEvents(t), this.emitEvent("pointerDown", [t, e]));
      }));
    var n = {
      mousedown: ["mousemove", "mouseup"],
      touchstart: ["touchmove", "touchend", "touchcancel"],
      pointerdown: ["pointermove", "pointerup", "pointercancel"],
    };
    return (
      (i._bindPostStartEvents = function (t) {
        if (t) {
          var e = n[t.type];
          (e.forEach(function (t) {
            s.addEventListener(t, this);
          }, this),
            (this._boundPointerEvents = e));
        }
      }),
      (i._unbindPostStartEvents = function () {
        this._boundPointerEvents &&
          (this._boundPointerEvents.forEach(function (t) {
            s.removeEventListener(t, this);
          }, this),
          delete this._boundPointerEvents);
      }),
      (i.onmousemove = function (t) {
        this._pointerMove(t, t);
      }),
      (i.onpointermove = function (t) {
        t.pointerId == this.pointerIdentifier && this._pointerMove(t, t);
      }),
      (i.ontouchmove = function (t) {
        var e = this.getTouch(t.changedTouches);
        e && this._pointerMove(t, e);
      }),
      (i._pointerMove = function (t, e) {
        this.pointerMove(t, e);
      }),
      (i.pointerMove = function (t, e) {
        this.emitEvent("pointerMove", [t, e]);
      }),
      (i.onmouseup = function (t) {
        this._pointerUp(t, t);
      }),
      (i.onpointerup = function (t) {
        t.pointerId == this.pointerIdentifier && this._pointerUp(t, t);
      }),
      (i.ontouchend = function (t) {
        var e = this.getTouch(t.changedTouches);
        e && this._pointerUp(t, e);
      }),
      (i._pointerUp = function (t, e) {
        (this._pointerDone(), this.pointerUp(t, e));
      }),
      (i.pointerUp = function (t, e) {
        this.emitEvent("pointerUp", [t, e]);
      }),
      (i._pointerDone = function () {
        (this._pointerReset(), this._unbindPostStartEvents(), this.pointerDone());
      }),
      (i._pointerReset = function () {
        ((this.isPointerDown = !1), delete this.pointerIdentifier);
      }),
      (i.pointerDone = function () {}),
      (i.onpointercancel = function (t) {
        t.pointerId == this.pointerIdentifier && this._pointerCancel(t, t);
      }),
      (i.ontouchcancel = function (t) {
        var e = this.getTouch(t.changedTouches);
        e && this._pointerCancel(t, e);
      }),
      (i._pointerCancel = function (t, e) {
        (this._pointerDone(), this.pointerCancel(t, e));
      }),
      (i.pointerCancel = function (t, e) {
        this.emitEvent("pointerCancel", [t, e]);
      }),
      (e.getPointerPoint = function (t) {
        return { x: t.pageX, y: t.pageY };
      }),
      e
    );
  }),
  (function (e, i) {
    "function" == typeof define && define.amd
      ? define("unidragger/unidragger", ["unipointer/unipointer"], function (t) {
          return i(e, t);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = i(e, require("unipointer")))
        : (e.Unidragger = i(e, e.Unipointer));
  })(window, function (o, t) {
    function e() {}
    var i = (e.prototype = Object.create(t.prototype));
    ((i.bindHandles = function () {
      this._bindHandles(!0);
    }),
      (i.unbindHandles = function () {
        this._bindHandles(!1);
      }),
      (i._bindHandles = function (t) {
        for (
          var e = (t = void 0 === t || t) ? "addEventListener" : "removeEventListener",
            i = t ? this._touchActionValue : "",
            n = 0;
          n < this.handles.length;
          n++
        ) {
          var s = this.handles[n];
          (this._bindStartEvent(s, t), s[e]("click", this), o.PointerEvent && (s.style.touchAction = i));
        }
      }),
      (i._touchActionValue = "none"),
      (i.pointerDown = function (t, e) {
        this.okayPointerDown(t) &&
          ((this.pointerDownPointer = e),
          t.preventDefault(),
          this.pointerDownBlur(),
          this._bindPostStartEvents(t),
          this.emitEvent("pointerDown", [t, e]));
      }));
    var s = { TEXTAREA: !0, INPUT: !0, SELECT: !0, OPTION: !0 },
      r = { radio: !0, checkbox: !0, button: !0, submit: !0, image: !0, file: !0 };
    return (
      (i.okayPointerDown = function (t) {
        var e = s[t.target.nodeName],
          i = r[t.target.type],
          n = !e || i;
        return (n || this._pointerReset(), n);
      }),
      (i.pointerDownBlur = function () {
        var t = document.activeElement;
        t && t.blur && t != document.body && t.blur();
      }),
      (i.pointerMove = function (t, e) {
        var i = this._dragPointerMove(t, e);
        (this.emitEvent("pointerMove", [t, e, i]), this._dragMove(t, e, i));
      }),
      (i._dragPointerMove = function (t, e) {
        var i = { x: e.pageX - this.pointerDownPointer.pageX, y: e.pageY - this.pointerDownPointer.pageY };
        return (!this.isDragging && this.hasDragStarted(i) && this._dragStart(t, e), i);
      }),
      (i.hasDragStarted = function (t) {
        return 3 < Math.abs(t.x) || 3 < Math.abs(t.y);
      }),
      (i.pointerUp = function (t, e) {
        (this.emitEvent("pointerUp", [t, e]), this._dragPointerUp(t, e));
      }),
      (i._dragPointerUp = function (t, e) {
        this.isDragging ? this._dragEnd(t, e) : this._staticClick(t, e);
      }),
      (i._dragStart = function (t, e) {
        ((this.isDragging = !0), (this.isPreventingClicks = !0), this.dragStart(t, e));
      }),
      (i.dragStart = function (t, e) {
        this.emitEvent("dragStart", [t, e]);
      }),
      (i._dragMove = function (t, e, i) {
        this.isDragging && this.dragMove(t, e, i);
      }),
      (i.dragMove = function (t, e, i) {
        (t.preventDefault(), this.emitEvent("dragMove", [t, e, i]));
      }),
      (i._dragEnd = function (t, e) {
        ((this.isDragging = !1),
          setTimeout(
            function () {
              delete this.isPreventingClicks;
            }.bind(this),
          ),
          this.dragEnd(t, e));
      }),
      (i.dragEnd = function (t, e) {
        this.emitEvent("dragEnd", [t, e]);
      }),
      (i.onclick = function (t) {
        this.isPreventingClicks && t.preventDefault();
      }),
      (i._staticClick = function (t, e) {
        (this.isIgnoringMouseUp && "mouseup" == t.type) ||
          (this.staticClick(t, e),
          "mouseup" != t.type &&
            ((this.isIgnoringMouseUp = !0),
            setTimeout(
              function () {
                delete this.isIgnoringMouseUp;
              }.bind(this),
              400,
            )));
      }),
      (i.staticClick = function (t, e) {
        this.emitEvent("staticClick", [t, e]);
      }),
      (e.getPointerPoint = t.getPointerPoint),
      e
    );
  }),
  (function (n, s) {
    "function" == typeof define && define.amd
      ? define("flickity/js/drag", ["./flickity", "unidragger/unidragger", "fizzy-ui-utils/utils"], function (t, e, i) {
          return s(n, t, e, i);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = s(n, require("./flickity"), require("unidragger"), require("fizzy-ui-utils")))
        : (n.Flickity = s(n, n.Flickity, n.Unidragger, n.fizzyUIUtils));
  })(window, function (i, t, e, a) {
    (a.extend(t.defaults, { draggable: ">1", dragThreshold: 3 }), t.createMethods.push("_createDrag"));
    var n = t.prototype;
    (a.extend(n, e.prototype), (n._touchActionValue = "pan-y"));
    var s = "createTouch" in document,
      o = !1;
    ((n._createDrag = function () {
      (this.on("activate", this.onActivateDrag),
        this.on("uiChange", this._uiChangeDrag),
        this.on("deactivate", this.onDeactivateDrag),
        this.on("cellChange", this.updateDraggable),
        s && !o && (i.addEventListener("touchmove", function () {}), (o = !0)));
    }),
      (n.onActivateDrag = function () {
        ((this.handles = [this.viewport]), this.bindHandles(), this.updateDraggable());
      }),
      (n.onDeactivateDrag = function () {
        (this.unbindHandles(), this.element.classList.remove("is-draggable"));
      }),
      (n.updateDraggable = function () {
        (">1" == this.options.draggable
          ? (this.isDraggable = 1 < this.slides.length)
          : (this.isDraggable = this.options.draggable),
          this.isDraggable
            ? this.element.classList.add("is-draggable")
            : this.element.classList.remove("is-draggable"));
      }),
      (n.bindDrag = function () {
        ((this.options.draggable = !0), this.updateDraggable());
      }),
      (n.unbindDrag = function () {
        ((this.options.draggable = !1), this.updateDraggable());
      }),
      (n._uiChangeDrag = function () {
        delete this.isFreeScrolling;
      }),
      (n.pointerDown = function (t, e) {
        this.isDraggable
          ? this.okayPointerDown(t) &&
            (this._pointerDownPreventDefault(t),
            this.pointerDownFocus(t),
            document.activeElement != this.element && this.pointerDownBlur(),
            (this.dragX = this.x),
            this.viewport.classList.add("is-pointer-down"),
            (this.pointerDownScroll = l()),
            i.addEventListener("scroll", this),
            this._pointerDownDefault(t, e))
          : this._pointerDownDefault(t, e);
      }),
      (n._pointerDownDefault = function (t, e) {
        ((this.pointerDownPointer = { pageX: e.pageX, pageY: e.pageY }),
          this._bindPostStartEvents(t),
          this.dispatchEvent("pointerDown", t, [e]));
      }));
    var r = { INPUT: !0, TEXTAREA: !0, SELECT: !0 };
    function l() {
      return { x: i.pageXOffset, y: i.pageYOffset };
    }
    return (
      (n.pointerDownFocus = function (t) {
        r[t.target.nodeName] || this.focus();
      }),
      (n._pointerDownPreventDefault = function (t) {
        var e = "touchstart" == t.type,
          i = "touch" == t.pointerType,
          n = r[t.target.nodeName];
        e || i || n || t.preventDefault();
      }),
      (n.hasDragStarted = function (t) {
        return Math.abs(t.x) > this.options.dragThreshold;
      }),
      (n.pointerUp = function (t, e) {
        (delete this.isTouchScrolling,
          this.viewport.classList.remove("is-pointer-down"),
          this.dispatchEvent("pointerUp", t, [e]),
          this._dragPointerUp(t, e));
      }),
      (n.pointerDone = function () {
        (i.removeEventListener("scroll", this), delete this.pointerDownScroll);
      }),
      (n.dragStart = function (t, e) {
        this.isDraggable &&
          ((this.dragStartPosition = this.x),
          this.startAnimation(),
          i.removeEventListener("scroll", this),
          this.dispatchEvent("dragStart", t, [e]));
      }),
      (n.pointerMove = function (t, e) {
        var i = this._dragPointerMove(t, e);
        (this.dispatchEvent("pointerMove", t, [e, i]), this._dragMove(t, e, i));
      }),
      (n.dragMove = function (t, e, i) {
        if (this.isDraggable) {
          (t.preventDefault(), (this.previousDragX = this.dragX));
          var n = this.options.rightToLeft ? -1 : 1;
          this.options.wrapAround && (i.x = i.x % this.slideableWidth);
          var s = this.dragStartPosition + i.x * n;
          if (!this.options.wrapAround && this.slides.length) {
            var o = Math.max(-this.slides[0].target, this.dragStartPosition);
            s = o < s ? 0.5 * (s + o) : s;
            var r = Math.min(-this.getLastSlide().target, this.dragStartPosition);
            s = s < r ? 0.5 * (s + r) : s;
          }
          ((this.dragX = s), (this.dragMoveTime = new Date()), this.dispatchEvent("dragMove", t, [e, i]));
        }
      }),
      (n.dragEnd = function (t, e) {
        if (this.isDraggable) {
          this.options.freeScroll && (this.isFreeScrolling = !0);
          var i = this.dragEndRestingSelect();
          if (this.options.freeScroll && !this.options.wrapAround) {
            var n = this.getRestingPosition();
            this.isFreeScrolling = -n > this.slides[0].target && -n < this.getLastSlide().target;
          } else this.options.freeScroll || i != this.selectedIndex || (i += this.dragEndBoostSelect());
          (delete this.previousDragX,
            (this.isDragSelect = this.options.wrapAround),
            this.select(i),
            delete this.isDragSelect,
            this.dispatchEvent("dragEnd", t, [e]));
        }
      }),
      (n.dragEndRestingSelect = function () {
        var t = this.getRestingPosition(),
          e = Math.abs(this.getSlideDistance(-t, this.selectedIndex)),
          i = this._getClosestResting(t, e, 1),
          n = this._getClosestResting(t, e, -1);
        return i.distance < n.distance ? i.index : n.index;
      }),
      (n._getClosestResting = function (t, e, i) {
        for (
          var n = this.selectedIndex,
            s = 1 / 0,
            o =
              this.options.contain && !this.options.wrapAround
                ? function (t, e) {
                    return t <= e;
                  }
                : function (t, e) {
                    return t < e;
                  };
          o(e, s) && ((n += i), (s = e), null !== (e = this.getSlideDistance(-t, n)));
        )
          e = Math.abs(e);
        return { distance: s, index: n - i };
      }),
      (n.getSlideDistance = function (t, e) {
        var i = this.slides.length,
          n = this.options.wrapAround && 1 < i,
          s = n ? a.modulo(e, i) : e,
          o = this.slides[s];
        if (!o) return null;
        var r = n ? this.slideableWidth * Math.floor(e / i) : 0;
        return t - (o.target + r);
      }),
      (n.dragEndBoostSelect = function () {
        if (void 0 === this.previousDragX || !this.dragMoveTime || 100 < new Date() - this.dragMoveTime) return 0;
        var t = this.getSlideDistance(-this.dragX, this.selectedIndex),
          e = this.previousDragX - this.dragX;
        return 0 < t && 0 < e ? 1 : t < 0 && e < 0 ? -1 : 0;
      }),
      (n.staticClick = function (t, e) {
        var i = this.getParentCell(t.target),
          n = i && i.element,
          s = i && this.cells.indexOf(i);
        this.dispatchEvent("staticClick", t, [e, n, s]);
      }),
      (n.onscroll = function () {
        var t = l(),
          e = this.pointerDownScroll.x - t.x,
          i = this.pointerDownScroll.y - t.y;
        (3 < Math.abs(e) || 3 < Math.abs(i)) && this._pointerDone();
      }),
      t
    );
  }),
  (function (n, s) {
    "function" == typeof define && define.amd
      ? define(
          "flickity/js/prev-next-button",
          ["./flickity", "unipointer/unipointer", "fizzy-ui-utils/utils"],
          function (t, e, i) {
            return s(n, t, e, i);
          },
        )
      : "object" == typeof module && module.exports
        ? (module.exports = s(n, require("./flickity"), require("unipointer"), require("fizzy-ui-utils")))
        : s(n, n.Flickity, n.Unipointer, n.fizzyUIUtils);
  })(window, function (t, e, i, n) {
    "use strict";
    var s = "http://www.w3.org/2000/svg";
    function o(t, e) {
      ((this.direction = t), (this.parent = e), this._create());
    }
    (((o.prototype = Object.create(i.prototype))._create = function () {
      ((this.isEnabled = !0), (this.isPrevious = -1 == this.direction));
      var t = this.parent.options.rightToLeft ? 1 : -1;
      this.isLeft = this.direction == t;
      var e = (this.element = document.createElement("button"));
      ((e.className = "flickity-button flickity-prev-next-button"),
        (e.className += this.isPrevious ? " previous" : " next"),
        e.setAttribute("type", "button"),
        this.disable(),
        e.setAttribute("aria-label", this.isPrevious ? "Previous" : "Next"));
      var i = this.createSVG();
      (e.appendChild(i),
        this.parent.on("select", this.update.bind(this)),
        this.on("pointerDown", this.parent.childUIPointerDown.bind(this.parent)));
    }),
      (o.prototype.activate = function () {
        (this.bindStartEvent(this.element),
          this.element.addEventListener("click", this),
          this.parent.element.appendChild(this.element));
      }),
      (o.prototype.deactivate = function () {
        (this.parent.element.removeChild(this.element),
          this.unbindStartEvent(this.element),
          this.element.removeEventListener("click", this));
      }),
      (o.prototype.createSVG = function () {
        var t = document.createElementNS(s, "svg");
        (t.setAttribute("class", "flickity-button-icon"), t.setAttribute("viewBox", "0 0 100 100"));
        var e = document.createElementNS(s, "path"),
          i = (function (t) {
            return "string" != typeof t
              ? "M " +
                  t.x0 +
                  ",50 L " +
                  t.x1 +
                  "," +
                  (t.y1 + 50) +
                  " L " +
                  t.x2 +
                  "," +
                  (t.y2 + 50) +
                  " L " +
                  t.x3 +
                  ",50  L " +
                  t.x2 +
                  "," +
                  (50 - t.y2) +
                  " L " +
                  t.x1 +
                  "," +
                  (50 - t.y1) +
                  " Z"
              : t;
          })(this.parent.options.arrowShape);
        return (
          e.setAttribute("d", i),
          e.setAttribute("class", "arrow"),
          this.isLeft || e.setAttribute("transform", "translate(100, 100) rotate(180) "),
          t.appendChild(e),
          t
        );
      }),
      (o.prototype.handleEvent = n.handleEvent),
      (o.prototype.onclick = function () {
        if (this.isEnabled) {
          this.parent.uiChange();
          var t = this.isPrevious ? "previous" : "next";
          this.parent[t]();
        }
      }),
      (o.prototype.enable = function () {
        this.isEnabled || ((this.element.disabled = !1), (this.isEnabled = !0));
      }),
      (o.prototype.disable = function () {
        this.isEnabled && ((this.element.disabled = !0), (this.isEnabled = !1));
      }),
      (o.prototype.update = function () {
        var t = this.parent.slides;
        if (this.parent.options.wrapAround && 1 < t.length) this.enable();
        else {
          var e = t.length ? t.length - 1 : 0,
            i = this.isPrevious ? 0 : e;
          this[this.parent.selectedIndex == i ? "disable" : "enable"]();
        }
      }),
      (o.prototype.destroy = function () {
        (this.deactivate(), this.allOff());
      }),
      n.extend(e.defaults, { prevNextButtons: !0, arrowShape: { x0: 10, x1: 60, y1: 50, x2: 70, y2: 40, x3: 30 } }),
      e.createMethods.push("_createPrevNextButtons"));
    var r = e.prototype;
    return (
      (r._createPrevNextButtons = function () {
        this.options.prevNextButtons &&
          ((this.prevButton = new o(-1, this)),
          (this.nextButton = new o(1, this)),
          this.on("activate", this.activatePrevNextButtons));
      }),
      (r.activatePrevNextButtons = function () {
        (this.prevButton.activate(), this.nextButton.activate(), this.on("deactivate", this.deactivatePrevNextButtons));
      }),
      (r.deactivatePrevNextButtons = function () {
        (this.prevButton.deactivate(),
          this.nextButton.deactivate(),
          this.off("deactivate", this.deactivatePrevNextButtons));
      }),
      (e.PrevNextButton = o),
      e
    );
  }),
  (function (n, s) {
    "function" == typeof define && define.amd
      ? define(
          "flickity/js/page-dots",
          ["./flickity", "unipointer/unipointer", "fizzy-ui-utils/utils"],
          function (t, e, i) {
            return s(n, t, e, i);
          },
        )
      : "object" == typeof module && module.exports
        ? (module.exports = s(n, require("./flickity"), require("unipointer"), require("fizzy-ui-utils")))
        : s(n, n.Flickity, n.Unipointer, n.fizzyUIUtils);
  })(window, function (t, e, i, n) {
    function s(t) {
      ((this.parent = t), this._create());
    }
    (((s.prototype = Object.create(i.prototype))._create = function () {
      ((this.holder = document.createElement("ol")),
        (this.holder.className = "flickity-page-dots"),
        (this.dots = []),
        (this.handleClick = this.onClick.bind(this)),
        this.on("pointerDown", this.parent.childUIPointerDown.bind(this.parent)));
    }),
      (s.prototype.activate = function () {
        (this.setDots(),
          this.holder.addEventListener("click", this.handleClick),
          this.bindStartEvent(this.holder),
          this.parent.element.appendChild(this.holder));
      }),
      (s.prototype.deactivate = function () {
        (this.holder.removeEventListener("click", this.handleClick),
          this.unbindStartEvent(this.holder),
          this.parent.element.removeChild(this.holder));
      }),
      (s.prototype.setDots = function () {
        var t = this.parent.slides.length - this.dots.length;
        0 < t ? this.addDots(t) : t < 0 && this.removeDots(-t);
      }),
      (s.prototype.addDots = function (t) {
        for (var e = document.createDocumentFragment(), i = [], n = this.dots.length, s = n + t, o = n; o < s; o++) {
          var r = document.createElement("li");
          ((r.className = "dot"), r.setAttribute("aria-label", "Page dot " + (o + 1)), e.appendChild(r), i.push(r));
        }
        (this.holder.appendChild(e), (this.dots = this.dots.concat(i)));
      }),
      (s.prototype.removeDots = function (t) {
        this.dots.splice(this.dots.length - t, t).forEach(function (t) {
          this.holder.removeChild(t);
        }, this);
      }),
      (s.prototype.updateSelected = function () {
        (this.selectedDot && ((this.selectedDot.className = "dot"), this.selectedDot.removeAttribute("aria-current")),
          this.dots.length &&
            ((this.selectedDot = this.dots[this.parent.selectedIndex]),
            (this.selectedDot.className = "dot is-selected"),
            this.selectedDot.setAttribute("aria-current", "step")));
      }),
      (s.prototype.onTap = s.prototype.onClick =
        function (t) {
          var e = t.target;
          if ("LI" == e.nodeName) {
            this.parent.uiChange();
            var i = this.dots.indexOf(e);
            this.parent.select(i);
          }
        }),
      (s.prototype.destroy = function () {
        (this.deactivate(), this.allOff());
      }),
      (e.PageDots = s),
      n.extend(e.defaults, { pageDots: !0 }),
      e.createMethods.push("_createPageDots"));
    var o = e.prototype;
    return (
      (o._createPageDots = function () {
        this.options.pageDots &&
          ((this.pageDots = new s(this)),
          this.on("activate", this.activatePageDots),
          this.on("select", this.updateSelectedPageDots),
          this.on("cellChange", this.updatePageDots),
          this.on("resize", this.updatePageDots),
          this.on("deactivate", this.deactivatePageDots));
      }),
      (o.activatePageDots = function () {
        this.pageDots.activate();
      }),
      (o.updateSelectedPageDots = function () {
        this.pageDots.updateSelected();
      }),
      (o.updatePageDots = function () {
        this.pageDots.setDots();
      }),
      (o.deactivatePageDots = function () {
        this.pageDots.deactivate();
      }),
      (e.PageDots = s),
      e
    );
  }),
  (function (t, n) {
    "function" == typeof define && define.amd
      ? define(
          "flickity/js/player",
          ["ev-emitter/ev-emitter", "fizzy-ui-utils/utils", "./flickity"],
          function (t, e, i) {
            return n(t, e, i);
          },
        )
      : "object" == typeof module && module.exports
        ? (module.exports = n(require("ev-emitter"), require("fizzy-ui-utils"), require("./flickity")))
        : n(t.EvEmitter, t.fizzyUIUtils, t.Flickity);
  })(window, function (t, e, i) {
    function n(t) {
      ((this.parent = t),
        (this.state = "stopped"),
        (this.onVisibilityChange = this.visibilityChange.bind(this)),
        (this.onVisibilityPlay = this.visibilityPlay.bind(this)));
    }
    (((n.prototype = Object.create(t.prototype)).play = function () {
      "playing" != this.state &&
        (document.hidden
          ? document.addEventListener("visibilitychange", this.onVisibilityPlay)
          : ((this.state = "playing"),
            document.addEventListener("visibilitychange", this.onVisibilityChange),
            this.tick()));
    }),
      (n.prototype.tick = function () {
        if ("playing" == this.state) {
          var t = this.parent.options.autoPlay;
          t = "number" == typeof t ? t : 3e3;
          var e = this;
          (this.clear(),
            (this.timeout = setTimeout(function () {
              (e.parent.next(!0), e.tick());
            }, t)));
        }
      }),
      (n.prototype.stop = function () {
        ((this.state = "stopped"),
          this.clear(),
          document.removeEventListener("visibilitychange", this.onVisibilityChange));
      }),
      (n.prototype.clear = function () {
        clearTimeout(this.timeout);
      }),
      (n.prototype.pause = function () {
        "playing" == this.state && ((this.state = "paused"), this.clear());
      }),
      (n.prototype.unpause = function () {
        "paused" == this.state && this.play();
      }),
      (n.prototype.visibilityChange = function () {
        this[document.hidden ? "pause" : "unpause"]();
      }),
      (n.prototype.visibilityPlay = function () {
        (this.play(), document.removeEventListener("visibilitychange", this.onVisibilityPlay));
      }),
      e.extend(i.defaults, { pauseAutoPlayOnHover: !0 }),
      i.createMethods.push("_createPlayer"));
    var s = i.prototype;
    return (
      (s._createPlayer = function () {
        ((this.player = new n(this)),
          this.on("activate", this.activatePlayer),
          this.on("uiChange", this.stopPlayer),
          this.on("pointerDown", this.stopPlayer),
          this.on("deactivate", this.deactivatePlayer));
      }),
      (s.activatePlayer = function () {
        this.options.autoPlay && (this.player.play(), this.element.addEventListener("mouseenter", this));
      }),
      (s.playPlayer = function () {
        this.player.play();
      }),
      (s.stopPlayer = function () {
        this.player.stop();
      }),
      (s.pausePlayer = function () {
        this.player.pause();
      }),
      (s.unpausePlayer = function () {
        this.player.unpause();
      }),
      (s.deactivatePlayer = function () {
        (this.player.stop(), this.element.removeEventListener("mouseenter", this));
      }),
      (s.onmouseenter = function () {
        this.options.pauseAutoPlayOnHover && (this.player.pause(), this.element.addEventListener("mouseleave", this));
      }),
      (s.onmouseleave = function () {
        (this.player.unpause(), this.element.removeEventListener("mouseleave", this));
      }),
      (i.Player = n),
      i
    );
  }),
  (function (i, n) {
    "function" == typeof define && define.amd
      ? define("flickity/js/add-remove-cell", ["./flickity", "fizzy-ui-utils/utils"], function (t, e) {
          return n(i, t, e);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = n(i, require("./flickity"), require("fizzy-ui-utils")))
        : n(i, i.Flickity, i.fizzyUIUtils);
  })(window, function (t, e, n) {
    var i = e.prototype;
    return (
      (i.insert = function (t, e) {
        var i = this._makeCells(t);
        if (i && i.length) {
          var n = this.cells.length;
          e = void 0 === e ? n : e;
          var s = (function (t) {
              var e = document.createDocumentFragment();
              return (
                t.forEach(function (t) {
                  e.appendChild(t.element);
                }),
                e
              );
            })(i),
            o = e == n;
          if (o) this.slider.appendChild(s);
          else {
            var r = this.cells[e].element;
            this.slider.insertBefore(s, r);
          }
          if (0 === e) this.cells = i.concat(this.cells);
          else if (o) this.cells = this.cells.concat(i);
          else {
            var a = this.cells.splice(e, n - e);
            this.cells = this.cells.concat(i).concat(a);
          }
          (this._sizeCells(i), this.cellChange(e, !0));
        }
      }),
      (i.append = function (t) {
        this.insert(t, this.cells.length);
      }),
      (i.prepend = function (t) {
        this.insert(t, 0);
      }),
      (i.remove = function (t) {
        var e = this.getCells(t);
        if (e && e.length) {
          var i = this.cells.length - 1;
          (e.forEach(function (t) {
            t.remove();
            var e = this.cells.indexOf(t);
            ((i = Math.min(e, i)), n.removeFrom(this.cells, t));
          }, this),
            this.cellChange(i, !0));
        }
      }),
      (i.cellSizeChange = function (t) {
        var e = this.getCell(t);
        if (e) {
          e.getSize();
          var i = this.cells.indexOf(e);
          this.cellChange(i);
        }
      }),
      (i.cellChange = function (t, e) {
        var i = this.selectedElement;
        (this._positionCells(t), this._getWrapShiftCells(), this.setGallerySize());
        var n = this.getCell(i);
        (n && (this.selectedIndex = this.getCellSlideIndex(n)),
          (this.selectedIndex = Math.min(this.slides.length - 1, this.selectedIndex)),
          this.emitEvent("cellChange", [t]),
          this.select(this.selectedIndex),
          e && this.positionSliderAtSelected());
      }),
      e
    );
  }),
  (function (i, n) {
    "function" == typeof define && define.amd
      ? define("flickity/js/lazyload", ["./flickity", "fizzy-ui-utils/utils"], function (t, e) {
          return n(i, t, e);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = n(i, require("./flickity"), require("fizzy-ui-utils")))
        : n(i, i.Flickity, i.fizzyUIUtils);
  })(window, function (t, e, o) {
    "use strict";
    e.createMethods.push("_createLazyload");
    var i = e.prototype;
    function s(t, e) {
      ((this.img = t), (this.flickity = e), this.load());
    }
    return (
      (i._createLazyload = function () {
        this.on("select", this.lazyLoad);
      }),
      (i.lazyLoad = function () {
        var t = this.options.lazyLoad;
        if (t) {
          var e = "number" == typeof t ? t : 0,
            i = this.getAdjacentCellElements(e),
            n = [];
          (i.forEach(function (t) {
            var e = (function (t) {
              if ("IMG" == t.nodeName) {
                var e = t.getAttribute("data-flickity-lazyload"),
                  i = t.getAttribute("data-flickity-lazyload-src"),
                  n = t.getAttribute("data-flickity-lazyload-srcset");
                if (e || i || n) return [t];
              }
              var s = t.querySelectorAll(
                "img[data-flickity-lazyload], img[data-flickity-lazyload-src], img[data-flickity-lazyload-srcset]",
              );
              return o.makeArray(s);
            })(t);
            n = n.concat(e);
          }),
            n.forEach(function (t) {
              new s(t, this);
            }, this));
        }
      }),
      (s.prototype.handleEvent = o.handleEvent),
      (s.prototype.load = function () {
        (this.img.addEventListener("load", this), this.img.addEventListener("error", this));
        var t = this.img.getAttribute("data-flickity-lazyload") || this.img.getAttribute("data-flickity-lazyload-src"),
          e = this.img.getAttribute("data-flickity-lazyload-srcset");
        ((this.img.src = t),
          e && this.img.setAttribute("srcset", e),
          this.img.removeAttribute("data-flickity-lazyload"),
          this.img.removeAttribute("data-flickity-lazyload-src"),
          this.img.removeAttribute("data-flickity-lazyload-srcset"));
      }),
      (s.prototype.onload = function (t) {
        this.complete(t, "flickity-lazyloaded");
      }),
      (s.prototype.onerror = function (t) {
        this.complete(t, "flickity-lazyerror");
      }),
      (s.prototype.complete = function (t, e) {
        (this.img.removeEventListener("load", this), this.img.removeEventListener("error", this));
        var i = this.flickity.getParentCell(this.img),
          n = i && i.element;
        (this.flickity.cellSizeChange(n), this.img.classList.add(e), this.flickity.dispatchEvent("lazyLoad", t, n));
      }),
      (e.LazyLoader = s),
      e
    );
  }),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define(
          "flickity/js/index",
          ["./flickity", "./drag", "./prev-next-button", "./page-dots", "./player", "./add-remove-cell", "./lazyload"],
          e,
        )
      : "object" == typeof module &&
        module.exports &&
        (module.exports = e(
          require("./flickity"),
          require("./drag"),
          require("./prev-next-button"),
          require("./page-dots"),
          require("./player"),
          require("./add-remove-cell"),
          require("./lazyload"),
        ));
  })(window, function (t) {
    return t;
  }),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define("flickity-as-nav-for/as-nav-for", ["flickity/js/index", "fizzy-ui-utils/utils"], e)
      : "object" == typeof module && module.exports
        ? (module.exports = e(require("flickity"), require("fizzy-ui-utils")))
        : (t.Flickity = e(t.Flickity, t.fizzyUIUtils));
  })(window, function (n, s) {
    n.createMethods.push("_createAsNavFor");
    var t = n.prototype;
    return (
      (t._createAsNavFor = function () {
        (this.on("activate", this.activateAsNavFor),
          this.on("deactivate", this.deactivateAsNavFor),
          this.on("destroy", this.destroyAsNavFor));
        var t = this.options.asNavFor;
        if (t) {
          var e = this;
          setTimeout(function () {
            e.setNavCompanion(t);
          });
        }
      }),
      (t.setNavCompanion = function (t) {
        t = s.getQueryElement(t);
        var e = n.data(t);
        if (e && e != this) {
          this.navCompanion = e;
          var i = this;
          ((this.onNavCompanionSelect = function () {
            i.navCompanionSelect();
          }),
            e.on("select", this.onNavCompanionSelect),
            this.on("staticClick", this.onNavStaticClick),
            this.navCompanionSelect(!0));
        }
      }),
      (t.navCompanionSelect = function (t) {
        var e = this.navCompanion && this.navCompanion.selectedCells;
        if (e) {
          var i = e[0],
            n = this.navCompanion.cells.indexOf(i),
            s = n + e.length - 1,
            o = Math.floor(
              (function (t, e, i) {
                return (e - t) * i + t;
              })(n, s, this.navCompanion.cellAlign),
            );
          if ((this.selectCell(o, !1, t), this.removeNavSelectedElements(), !(o >= this.cells.length))) {
            var r = this.cells.slice(n, 1 + s);
            ((this.navSelectedElements = r.map(function (t) {
              return t.element;
            })),
              this.changeNavSelectedClass("add"));
          }
        }
      }),
      (t.changeNavSelectedClass = function (e) {
        this.navSelectedElements.forEach(function (t) {
          t.classList[e]("is-nav-selected");
        });
      }),
      (t.activateAsNavFor = function () {
        this.navCompanionSelect(!0);
      }),
      (t.removeNavSelectedElements = function () {
        this.navSelectedElements && (this.changeNavSelectedClass("remove"), delete this.navSelectedElements);
      }),
      (t.onNavStaticClick = function (t, e, i, n) {
        "number" == typeof n && this.navCompanion.selectCell(n);
      }),
      (t.deactivateAsNavFor = function () {
        this.removeNavSelectedElements();
      }),
      (t.destroyAsNavFor = function () {
        this.navCompanion &&
          (this.navCompanion.off("select", this.onNavCompanionSelect),
          this.off("staticClick", this.onNavStaticClick),
          delete this.navCompanion);
      }),
      n
    );
  }),
  (function (e, i) {
    "use strict";
    "function" == typeof define && define.amd
      ? define("imagesloaded/imagesloaded", ["ev-emitter/ev-emitter"], function (t) {
          return i(e, t);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = i(e, require("ev-emitter")))
        : (e.imagesLoaded = i(e, e.EvEmitter));
  })("undefined" != typeof window ? window : this, function (e, t) {
    var s = e.jQuery,
      o = e.console;
    function r(t, e) {
      for (var i in e) t[i] = e[i];
      return t;
    }
    var a = Array.prototype.slice;
    function l(t, e, i) {
      if (!(this instanceof l)) return new l(t, e, i);
      var n = t;
      ("string" == typeof t && (n = document.querySelectorAll(t)),
        n
          ? ((this.elements = (function (t) {
              return Array.isArray(t) ? t : "object" == typeof t && "number" == typeof t.length ? a.call(t) : [t];
            })(n)),
            (this.options = r({}, this.options)),
            "function" == typeof e ? (i = e) : r(this.options, e),
            i && this.on("always", i),
            this.getImages(),
            s && (this.jqDeferred = new s.Deferred()),
            setTimeout(this.check.bind(this)))
          : o.error("Bad element for imagesLoaded " + (n || t)));
    }
    (((l.prototype = Object.create(t.prototype)).options = {}),
      (l.prototype.getImages = function () {
        ((this.images = []), this.elements.forEach(this.addElementImages, this));
      }),
      (l.prototype.addElementImages = function (t) {
        ("IMG" == t.nodeName && this.addImage(t), !0 === this.options.background && this.addElementBackgroundImages(t));
        var e = t.nodeType;
        if (e && h[e]) {
          for (var i = t.querySelectorAll("img"), n = 0; n < i.length; n++) {
            var s = i[n];
            this.addImage(s);
          }
          if ("string" == typeof this.options.background) {
            var o = t.querySelectorAll(this.options.background);
            for (n = 0; n < o.length; n++) {
              var r = o[n];
              this.addElementBackgroundImages(r);
            }
          }
        }
      }));
    var h = { 1: !0, 9: !0, 11: !0 };
    function i(t) {
      this.img = t;
    }
    function n(t, e) {
      ((this.url = t), (this.element = e), (this.img = new Image()));
    }
    return (
      (l.prototype.addElementBackgroundImages = function (t) {
        var e = getComputedStyle(t);
        if (e)
          for (var i = /url\((['"])?(.*?)\1\)/gi, n = i.exec(e.backgroundImage); null !== n;) {
            var s = n && n[2];
            (s && this.addBackground(s, t), (n = i.exec(e.backgroundImage)));
          }
      }),
      (l.prototype.addImage = function (t) {
        var e = new i(t);
        this.images.push(e);
      }),
      (l.prototype.addBackground = function (t, e) {
        var i = new n(t, e);
        this.images.push(i);
      }),
      (l.prototype.check = function () {
        var n = this;
        function e(t, e, i) {
          setTimeout(function () {
            n.progress(t, e, i);
          });
        }
        ((this.progressedCount = 0),
          (this.hasAnyBroken = !1),
          this.images.length
            ? this.images.forEach(function (t) {
                (t.once("progress", e), t.check());
              })
            : this.complete());
      }),
      (l.prototype.progress = function (t, e, i) {
        (this.progressedCount++,
          (this.hasAnyBroken = this.hasAnyBroken || !t.isLoaded),
          this.emitEvent("progress", [this, t, e]),
          this.jqDeferred && this.jqDeferred.notify && this.jqDeferred.notify(this, t),
          this.progressedCount == this.images.length && this.complete(),
          this.options.debug && o && o.log("progress: " + i, t, e));
      }),
      (l.prototype.complete = function () {
        var t = this.hasAnyBroken ? "fail" : "done";
        if (((this.isComplete = !0), this.emitEvent(t, [this]), this.emitEvent("always", [this]), this.jqDeferred)) {
          var e = this.hasAnyBroken ? "reject" : "resolve";
          this.jqDeferred[e](this);
        }
      }),
      ((i.prototype = Object.create(t.prototype)).check = function () {
        this.getIsImageComplete()
          ? this.confirm(0 !== this.img.naturalWidth, "naturalWidth")
          : ((this.proxyImage = new Image()),
            this.proxyImage.addEventListener("load", this),
            this.proxyImage.addEventListener("error", this),
            this.img.addEventListener("load", this),
            this.img.addEventListener("error", this),
            (this.proxyImage.src = this.img.src));
      }),
      (i.prototype.getIsImageComplete = function () {
        return this.img.complete && this.img.naturalWidth;
      }),
      (i.prototype.confirm = function (t, e) {
        ((this.isLoaded = t), this.emitEvent("progress", [this, this.img, e]));
      }),
      (i.prototype.handleEvent = function (t) {
        var e = "on" + t.type;
        this[e] && this[e](t);
      }),
      (i.prototype.onload = function () {
        (this.confirm(!0, "onload"), this.unbindEvents());
      }),
      (i.prototype.onerror = function () {
        (this.confirm(!1, "onerror"), this.unbindEvents());
      }),
      (i.prototype.unbindEvents = function () {
        (this.proxyImage.removeEventListener("load", this),
          this.proxyImage.removeEventListener("error", this),
          this.img.removeEventListener("load", this),
          this.img.removeEventListener("error", this));
      }),
      ((n.prototype = Object.create(i.prototype)).check = function () {
        (this.img.addEventListener("load", this),
          this.img.addEventListener("error", this),
          (this.img.src = this.url),
          this.getIsImageComplete() &&
            (this.confirm(0 !== this.img.naturalWidth, "naturalWidth"), this.unbindEvents()));
      }),
      (n.prototype.unbindEvents = function () {
        (this.img.removeEventListener("load", this), this.img.removeEventListener("error", this));
      }),
      (n.prototype.confirm = function (t, e) {
        ((this.isLoaded = t), this.emitEvent("progress", [this, this.element, e]));
      }),
      (l.makeJQueryPlugin = function (t) {
        (t = t || e.jQuery) &&
          ((s = t).fn.imagesLoaded = function (t, e) {
            return new l(this, t, e).jqDeferred.promise(s(this));
          });
      }),
      l.makeJQueryPlugin(),
      l
    );
  }),
  (function (i, n) {
    "function" == typeof define && define.amd
      ? define(["flickity/js/index", "imagesloaded/imagesloaded"], function (t, e) {
          return n(i, t, e);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = n(i, require("flickity"), require("imagesloaded")))
        : (i.Flickity = n(i, i.Flickity, i.imagesLoaded));
  })(window, function (t, e, i) {
    "use strict";
    e.createMethods.push("_createImagesLoaded");
    var n = e.prototype;
    return (
      (n._createImagesLoaded = function () {
        this.on("activate", this.imagesLoaded);
      }),
      (n.imagesLoaded = function () {
        if (this.options.imagesLoaded) {
          var n = this;
          i(this.slider).on("progress", function (t, e) {
            var i = n.getParentCell(e.img);
            (n.cellSizeChange(i && i.element), n.options.freeScroll || n.positionSliderAtSelected());
          });
        }
      }),
      e
    );
  }));
/*! This file is auto-generated */
/*!
 * imagesLoaded PACKAGED v4.1.4
 * JavaScript is all like "You images are done yet or what?"
 * MIT License
 */
(!(function (e, t) {
  "function" == typeof define && define.amd
    ? define("ev-emitter/ev-emitter", t)
    : "object" == typeof module && module.exports
      ? (module.exports = t())
      : (e.EvEmitter = t());
})("undefined" != typeof window ? window : this, function () {
  function e() {}
  var t = e.prototype;
  return (
    (t.on = function (e, t) {
      if (e && t) {
        var i = (this._events = this._events || {}),
          n = (i[e] = i[e] || []);
        return (n.indexOf(t) == -1 && n.push(t), this);
      }
    }),
    (t.once = function (e, t) {
      if (e && t) {
        this.on(e, t);
        var i = (this._onceEvents = this._onceEvents || {}),
          n = (i[e] = i[e] || {});
        return ((n[t] = !0), this);
      }
    }),
    (t.off = function (e, t) {
      var i = this._events && this._events[e];
      if (i && i.length) {
        var n = i.indexOf(t);
        return (n != -1 && i.splice(n, 1), this);
      }
    }),
    (t.emitEvent = function (e, t) {
      var i = this._events && this._events[e];
      if (i && i.length) {
        ((i = i.slice(0)), (t = t || []));
        for (var n = this._onceEvents && this._onceEvents[e], o = 0; o < i.length; o++) {
          var r = i[o],
            s = n && n[r];
          (s && (this.off(e, r), delete n[r]), r.apply(this, t));
        }
        return this;
      }
    }),
    (t.allOff = function () {
      (delete this._events, delete this._onceEvents);
    }),
    e
  );
}),
  (function (e, t) {
    "use strict";
    "function" == typeof define && define.amd
      ? define(["ev-emitter/ev-emitter"], function (i) {
          return t(e, i);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = t(e, require("ev-emitter")))
        : (e.imagesLoaded = t(e, e.EvEmitter));
  })("undefined" != typeof window ? window : this, function (e, t) {
    function i(e, t) {
      for (var i in t) e[i] = t[i];
      return e;
    }
    function n(e) {
      if (Array.isArray(e)) return e;
      var t = "object" == typeof e && "number" == typeof e.length;
      return t ? d.call(e) : [e];
    }
    function o(e, t, r) {
      if (!(this instanceof o)) return new o(e, t, r);
      var s = e;
      return (
        "string" == typeof e && (s = document.querySelectorAll(e)),
        s
          ? ((this.elements = n(s)),
            (this.options = i({}, this.options)),
            "function" == typeof t ? (r = t) : i(this.options, t),
            r && this.on("always", r),
            this.getImages(),
            h && (this.jqDeferred = new h.Deferred()),
            void setTimeout(this.check.bind(this)))
          : void a.error("Bad element for imagesLoaded " + (s || e))
      );
    }
    function r(e) {
      this.img = e;
    }
    function s(e, t) {
      ((this.url = e), (this.element = t), (this.img = new Image()));
    }
    var h = e.jQuery,
      a = e.console,
      d = Array.prototype.slice;
    ((o.prototype = Object.create(t.prototype)),
      (o.prototype.options = {}),
      (o.prototype.getImages = function () {
        ((this.images = []), this.elements.forEach(this.addElementImages, this));
      }),
      (o.prototype.addElementImages = function (e) {
        ("IMG" == e.nodeName && this.addImage(e), this.options.background === !0 && this.addElementBackgroundImages(e));
        var t = e.nodeType;
        if (t && u[t]) {
          for (var i = e.querySelectorAll("img"), n = 0; n < i.length; n++) {
            var o = i[n];
            this.addImage(o);
          }
          if ("string" == typeof this.options.background) {
            var r = e.querySelectorAll(this.options.background);
            for (n = 0; n < r.length; n++) {
              var s = r[n];
              this.addElementBackgroundImages(s);
            }
          }
        }
      }));
    var u = { 1: !0, 9: !0, 11: !0 };
    return (
      (o.prototype.addElementBackgroundImages = function (e) {
        var t = getComputedStyle(e);
        if (t)
          for (var i = /url\((['"])?(.*?)\1\)/gi, n = i.exec(t.backgroundImage); null !== n;) {
            var o = n && n[2];
            (o && this.addBackground(o, e), (n = i.exec(t.backgroundImage)));
          }
      }),
      (o.prototype.addImage = function (e) {
        var t = new r(e);
        this.images.push(t);
      }),
      (o.prototype.addBackground = function (e, t) {
        var i = new s(e, t);
        this.images.push(i);
      }),
      (o.prototype.check = function () {
        function e(e, i, n) {
          setTimeout(function () {
            t.progress(e, i, n);
          });
        }
        var t = this;
        return (
          (this.progressedCount = 0),
          (this.hasAnyBroken = !1),
          this.images.length
            ? void this.images.forEach(function (t) {
                (t.once("progress", e), t.check());
              })
            : void this.complete()
        );
      }),
      (o.prototype.progress = function (e, t, i) {
        (this.progressedCount++,
          (this.hasAnyBroken = this.hasAnyBroken || !e.isLoaded),
          this.emitEvent("progress", [this, e, t]),
          this.jqDeferred && this.jqDeferred.notify && this.jqDeferred.notify(this, e),
          this.progressedCount == this.images.length && this.complete(),
          this.options.debug && a && a.log("progress: " + i, e, t));
      }),
      (o.prototype.complete = function () {
        var e = this.hasAnyBroken ? "fail" : "done";
        if (((this.isComplete = !0), this.emitEvent(e, [this]), this.emitEvent("always", [this]), this.jqDeferred)) {
          var t = this.hasAnyBroken ? "reject" : "resolve";
          this.jqDeferred[t](this);
        }
      }),
      (r.prototype = Object.create(t.prototype)),
      (r.prototype.check = function () {
        var e = this.getIsImageComplete();
        return e
          ? void this.confirm(0 !== this.img.naturalWidth, "naturalWidth")
          : ((this.proxyImage = new Image()),
            this.proxyImage.addEventListener("load", this),
            this.proxyImage.addEventListener("error", this),
            this.img.addEventListener("load", this),
            this.img.addEventListener("error", this),
            void (this.proxyImage.src = this.img.src));
      }),
      (r.prototype.getIsImageComplete = function () {
        return this.img.complete && this.img.naturalWidth;
      }),
      (r.prototype.confirm = function (e, t) {
        ((this.isLoaded = e), this.emitEvent("progress", [this, this.img, t]));
      }),
      (r.prototype.handleEvent = function (e) {
        var t = "on" + e.type;
        this[t] && this[t](e);
      }),
      (r.prototype.onload = function () {
        (this.confirm(!0, "onload"), this.unbindEvents());
      }),
      (r.prototype.onerror = function () {
        (this.confirm(!1, "onerror"), this.unbindEvents());
      }),
      (r.prototype.unbindEvents = function () {
        (this.proxyImage.removeEventListener("load", this),
          this.proxyImage.removeEventListener("error", this),
          this.img.removeEventListener("load", this),
          this.img.removeEventListener("error", this));
      }),
      (s.prototype = Object.create(r.prototype)),
      (s.prototype.check = function () {
        (this.img.addEventListener("load", this), this.img.addEventListener("error", this), (this.img.src = this.url));
        var e = this.getIsImageComplete();
        e && (this.confirm(0 !== this.img.naturalWidth, "naturalWidth"), this.unbindEvents());
      }),
      (s.prototype.unbindEvents = function () {
        (this.img.removeEventListener("load", this), this.img.removeEventListener("error", this));
      }),
      (s.prototype.confirm = function (e, t) {
        ((this.isLoaded = e), this.emitEvent("progress", [this, this.element, t]));
      }),
      (o.makeJQueryPlugin = function (t) {
        ((t = t || e.jQuery),
          t &&
            ((h = t),
            (h.fn.imagesLoaded = function (e, t) {
              var i = new o(this, e, t);
              return i.jqDeferred.promise(h(this));
            })));
      }),
      o.makeJQueryPlugin(),
      o
    );
  }));
/*! QRious v4.0.2 | (C) 2017 Alasdair Mercer | GPL v3 License
Based on jsqrencode | (C) 2010 tz@execpc.com | GPL v3 License
*/
!(function (t, e) {
  "object" == typeof exports && "undefined" != typeof module
    ? (module.exports = e())
    : "function" == typeof define && define.amd
      ? define(e)
      : (t.QRious = e());
})(this, function () {
  "use strict";
  function t(t, e) {
    var n;
    return (
      "function" == typeof Object.create
        ? (n = Object.create(t))
        : ((s.prototype = t), (n = new s()), (s.prototype = null)),
      e && i(!0, n, e),
      n
    );
  }
  function e(e, n, s, r) {
    var o = this;
    return (
      "string" != typeof e && ((r = s), (s = n), (n = e), (e = null)),
      "function" != typeof n &&
        ((r = s),
        (s = n),
        (n = function () {
          return o.apply(this, arguments);
        })),
      i(!1, n, o, r),
      (n.prototype = t(o.prototype, s)),
      (n.prototype.constructor = n),
      (n.class_ = e || o.class_),
      (n.super_ = o),
      n
    );
  }
  function i(t, e, i) {
    for (var n, s, a = 0, h = (i = o.call(arguments, 2)).length; a < h; a++) {
      s = i[a];
      for (n in s) (t && !r.call(s, n)) || (e[n] = s[n]);
    }
  }
  function n() {}
  var s = function () {},
    r = Object.prototype.hasOwnProperty,
    o = Array.prototype.slice,
    a = e;
  ((n.class_ = "Nevis"), (n.super_ = Object), (n.extend = a));
  var h = n,
    f = h.extend(
      function (t, e, i) {
        ((this.qrious = t), (this.element = e), (this.element.qrious = t), (this.enabled = Boolean(i)));
      },
      {
        draw: function (t) {},
        getElement: function () {
          return (this.enabled || ((this.enabled = !0), this.render()), this.element);
        },
        getModuleSize: function (t) {
          var e = this.qrious,
            i = e.padding || 0,
            n = Math.floor((e.size - 2 * i) / t.width);
          return Math.max(1, n);
        },
        getOffset: function (t) {
          var e = this.qrious,
            i = e.padding;
          if (null != i) return i;
          var n = this.getModuleSize(t),
            s = Math.floor((e.size - n * t.width) / 2);
          return Math.max(0, s);
        },
        render: function (t) {
          this.enabled && (this.resize(), this.reset(), this.draw(t));
        },
        reset: function () {},
        resize: function () {},
      },
    ),
    c = f.extend({
      draw: function (t) {
        var e,
          i,
          n = this.qrious,
          s = this.getModuleSize(t),
          r = this.getOffset(t),
          o = this.element.getContext("2d");
        for (o.fillStyle = n.foreground, o.globalAlpha = n.foregroundAlpha, e = 0; e < t.width; e++)
          for (i = 0; i < t.width; i++) t.buffer[i * t.width + e] && o.fillRect(s * e + r, s * i + r, s, s);
      },
      reset: function () {
        var t = this.qrious,
          e = this.element.getContext("2d"),
          i = t.size;
        ((e.lineWidth = 1),
          e.clearRect(0, 0, i, i),
          (e.fillStyle = t.background),
          (e.globalAlpha = t.backgroundAlpha),
          e.fillRect(0, 0, i, i));
      },
      resize: function () {
        var t = this.element;
        t.width = t.height = this.qrious.size;
      },
    }),
    u = h.extend(null, {
      BLOCK: [
        0, 11, 15, 19, 23, 27, 31, 16, 18, 20, 22, 24, 26, 28, 20, 22, 24, 24, 26, 28, 28, 22, 24, 24, 26, 26, 28, 28,
        24, 24, 26, 26, 26, 28, 28, 24, 26, 26, 26, 28, 28,
      ],
    }),
    l = h.extend(null, {
      BLOCKS: [
        1, 0, 19, 7, 1, 0, 16, 10, 1, 0, 13, 13, 1, 0, 9, 17, 1, 0, 34, 10, 1, 0, 28, 16, 1, 0, 22, 22, 1, 0, 16, 28, 1,
        0, 55, 15, 1, 0, 44, 26, 2, 0, 17, 18, 2, 0, 13, 22, 1, 0, 80, 20, 2, 0, 32, 18, 2, 0, 24, 26, 4, 0, 9, 16, 1,
        0, 108, 26, 2, 0, 43, 24, 2, 2, 15, 18, 2, 2, 11, 22, 2, 0, 68, 18, 4, 0, 27, 16, 4, 0, 19, 24, 4, 0, 15, 28, 2,
        0, 78, 20, 4, 0, 31, 18, 2, 4, 14, 18, 4, 1, 13, 26, 2, 0, 97, 24, 2, 2, 38, 22, 4, 2, 18, 22, 4, 2, 14, 26, 2,
        0, 116, 30, 3, 2, 36, 22, 4, 4, 16, 20, 4, 4, 12, 24, 2, 2, 68, 18, 4, 1, 43, 26, 6, 2, 19, 24, 6, 2, 15, 28, 4,
        0, 81, 20, 1, 4, 50, 30, 4, 4, 22, 28, 3, 8, 12, 24, 2, 2, 92, 24, 6, 2, 36, 22, 4, 6, 20, 26, 7, 4, 14, 28, 4,
        0, 107, 26, 8, 1, 37, 22, 8, 4, 20, 24, 12, 4, 11, 22, 3, 1, 115, 30, 4, 5, 40, 24, 11, 5, 16, 20, 11, 5, 12,
        24, 5, 1, 87, 22, 5, 5, 41, 24, 5, 7, 24, 30, 11, 7, 12, 24, 5, 1, 98, 24, 7, 3, 45, 28, 15, 2, 19, 24, 3, 13,
        15, 30, 1, 5, 107, 28, 10, 1, 46, 28, 1, 15, 22, 28, 2, 17, 14, 28, 5, 1, 120, 30, 9, 4, 43, 26, 17, 1, 22, 28,
        2, 19, 14, 28, 3, 4, 113, 28, 3, 11, 44, 26, 17, 4, 21, 26, 9, 16, 13, 26, 3, 5, 107, 28, 3, 13, 41, 26, 15, 5,
        24, 30, 15, 10, 15, 28, 4, 4, 116, 28, 17, 0, 42, 26, 17, 6, 22, 28, 19, 6, 16, 30, 2, 7, 111, 28, 17, 0, 46,
        28, 7, 16, 24, 30, 34, 0, 13, 24, 4, 5, 121, 30, 4, 14, 47, 28, 11, 14, 24, 30, 16, 14, 15, 30, 6, 4, 117, 30,
        6, 14, 45, 28, 11, 16, 24, 30, 30, 2, 16, 30, 8, 4, 106, 26, 8, 13, 47, 28, 7, 22, 24, 30, 22, 13, 15, 30, 10,
        2, 114, 28, 19, 4, 46, 28, 28, 6, 22, 28, 33, 4, 16, 30, 8, 4, 122, 30, 22, 3, 45, 28, 8, 26, 23, 30, 12, 28,
        15, 30, 3, 10, 117, 30, 3, 23, 45, 28, 4, 31, 24, 30, 11, 31, 15, 30, 7, 7, 116, 30, 21, 7, 45, 28, 1, 37, 23,
        30, 19, 26, 15, 30, 5, 10, 115, 30, 19, 10, 47, 28, 15, 25, 24, 30, 23, 25, 15, 30, 13, 3, 115, 30, 2, 29, 46,
        28, 42, 1, 24, 30, 23, 28, 15, 30, 17, 0, 115, 30, 10, 23, 46, 28, 10, 35, 24, 30, 19, 35, 15, 30, 17, 1, 115,
        30, 14, 21, 46, 28, 29, 19, 24, 30, 11, 46, 15, 30, 13, 6, 115, 30, 14, 23, 46, 28, 44, 7, 24, 30, 59, 1, 16,
        30, 12, 7, 121, 30, 12, 26, 47, 28, 39, 14, 24, 30, 22, 41, 15, 30, 6, 14, 121, 30, 6, 34, 47, 28, 46, 10, 24,
        30, 2, 64, 15, 30, 17, 4, 122, 30, 29, 14, 46, 28, 49, 10, 24, 30, 24, 46, 15, 30, 4, 18, 122, 30, 13, 32, 46,
        28, 48, 14, 24, 30, 42, 32, 15, 30, 20, 4, 117, 30, 40, 7, 47, 28, 43, 22, 24, 30, 10, 67, 15, 30, 19, 6, 118,
        30, 18, 31, 47, 28, 34, 34, 24, 30, 20, 61, 15, 30,
      ],
      FINAL_FORMAT: [
        30660, 29427, 32170, 30877, 26159, 25368, 27713, 26998, 21522, 20773, 24188, 23371, 17913, 16590, 20375, 19104,
        13663, 12392, 16177, 14854, 9396, 8579, 11994, 11245, 5769, 5054, 7399, 6608, 1890, 597, 3340, 2107,
      ],
      LEVELS: { L: 1, M: 2, Q: 3, H: 4 },
    }),
    _ = h.extend(null, {
      EXPONENT: [
        1, 2, 4, 8, 16, 32, 64, 128, 29, 58, 116, 232, 205, 135, 19, 38, 76, 152, 45, 90, 180, 117, 234, 201, 143, 3, 6,
        12, 24, 48, 96, 192, 157, 39, 78, 156, 37, 74, 148, 53, 106, 212, 181, 119, 238, 193, 159, 35, 70, 140, 5, 10,
        20, 40, 80, 160, 93, 186, 105, 210, 185, 111, 222, 161, 95, 190, 97, 194, 153, 47, 94, 188, 101, 202, 137, 15,
        30, 60, 120, 240, 253, 231, 211, 187, 107, 214, 177, 127, 254, 225, 223, 163, 91, 182, 113, 226, 217, 175, 67,
        134, 17, 34, 68, 136, 13, 26, 52, 104, 208, 189, 103, 206, 129, 31, 62, 124, 248, 237, 199, 147, 59, 118, 236,
        197, 151, 51, 102, 204, 133, 23, 46, 92, 184, 109, 218, 169, 79, 158, 33, 66, 132, 21, 42, 84, 168, 77, 154, 41,
        82, 164, 85, 170, 73, 146, 57, 114, 228, 213, 183, 115, 230, 209, 191, 99, 198, 145, 63, 126, 252, 229, 215,
        179, 123, 246, 241, 255, 227, 219, 171, 75, 150, 49, 98, 196, 149, 55, 110, 220, 165, 87, 174, 65, 130, 25, 50,
        100, 200, 141, 7, 14, 28, 56, 112, 224, 221, 167, 83, 166, 81, 162, 89, 178, 121, 242, 249, 239, 195, 155, 43,
        86, 172, 69, 138, 9, 18, 36, 72, 144, 61, 122, 244, 245, 247, 243, 251, 235, 203, 139, 11, 22, 44, 88, 176, 125,
        250, 233, 207, 131, 27, 54, 108, 216, 173, 71, 142, 0,
      ],
      LOG: [
        255, 0, 1, 25, 2, 50, 26, 198, 3, 223, 51, 238, 27, 104, 199, 75, 4, 100, 224, 14, 52, 141, 239, 129, 28, 193,
        105, 248, 200, 8, 76, 113, 5, 138, 101, 47, 225, 36, 15, 33, 53, 147, 142, 218, 240, 18, 130, 69, 29, 181, 194,
        125, 106, 39, 249, 185, 201, 154, 9, 120, 77, 228, 114, 166, 6, 191, 139, 98, 102, 221, 48, 253, 226, 152, 37,
        179, 16, 145, 34, 136, 54, 208, 148, 206, 143, 150, 219, 189, 241, 210, 19, 92, 131, 56, 70, 64, 30, 66, 182,
        163, 195, 72, 126, 110, 107, 58, 40, 84, 250, 133, 186, 61, 202, 94, 155, 159, 10, 21, 121, 43, 78, 212, 229,
        172, 115, 243, 167, 87, 7, 112, 192, 247, 140, 128, 99, 13, 103, 74, 222, 237, 49, 197, 254, 24, 227, 165, 153,
        119, 38, 184, 180, 124, 17, 68, 146, 217, 35, 32, 137, 46, 55, 63, 209, 91, 149, 188, 207, 205, 144, 135, 151,
        178, 220, 252, 190, 97, 242, 86, 211, 171, 20, 42, 93, 158, 132, 60, 57, 83, 71, 109, 65, 162, 31, 45, 67, 216,
        183, 123, 164, 118, 196, 23, 73, 236, 127, 12, 111, 246, 108, 161, 59, 82, 41, 157, 85, 170, 251, 96, 134, 177,
        187, 204, 62, 90, 203, 89, 95, 176, 156, 169, 160, 81, 11, 245, 22, 235, 122, 117, 44, 215, 79, 174, 213, 233,
        230, 231, 173, 232, 116, 214, 244, 234, 168, 80, 88, 175,
      ],
    }),
    d = h.extend(null, {
      BLOCK: [
        3220, 1468, 2713, 1235, 3062, 1890, 2119, 1549, 2344, 2936, 1117, 2583, 1330, 2470, 1667, 2249, 2028, 3780, 481,
        4011, 142, 3098, 831, 3445, 592, 2517, 1776, 2234, 1951, 2827, 1070, 2660, 1345, 3177,
      ],
    }),
    v = h.extend(
      function (t) {
        var e,
          i,
          n,
          s,
          r,
          o = t.value.length;
        for (
          this._badness = [],
            this._level = l.LEVELS[t.level],
            this._polynomial = [],
            this._value = t.value,
            this._version = 0,
            this._stringBuffer = [];
          this._version < 40 &&
          (this._version++,
          (n = 4 * (this._level - 1) + 16 * (this._version - 1)),
          (s = l.BLOCKS[n++]),
          (r = l.BLOCKS[n++]),
          (e = l.BLOCKS[n++]),
          (i = l.BLOCKS[n]),
          (n = e * (s + r) + r - 3 + (this._version <= 9)),
          !(o <= n));
        );
        ((this._dataBlock = e), (this._eccBlock = i), (this._neccBlock1 = s), (this._neccBlock2 = r));
        var a = (this.width = 17 + 4 * this._version);
        ((this.buffer = v._createArray(a * a)),
          (this._ecc = v._createArray(e + (e + i) * (s + r) + r)),
          (this._mask = v._createArray((a * (a + 1) + 1) / 2)),
          this._insertFinders(),
          this._insertAlignments(),
          (this.buffer[8 + a * (a - 8)] = 1),
          this._insertTimingGap(),
          this._reverseMask(),
          this._insertTimingRowAndColumn(),
          this._insertVersion(),
          this._syncMask(),
          this._convertBitStream(o),
          this._calculatePolynomial(),
          this._appendEccToData(),
          this._interleaveBlocks(),
          this._pack(),
          this._finish());
      },
      {
        _addAlignment: function (t, e) {
          var i,
            n = this.buffer,
            s = this.width;
          for (n[t + s * e] = 1, i = -2; i < 2; i++)
            ((n[t + i + s * (e - 2)] = 1),
              (n[t - 2 + s * (e + i + 1)] = 1),
              (n[t + 2 + s * (e + i)] = 1),
              (n[t + i + 1 + s * (e + 2)] = 1));
          for (i = 0; i < 2; i++)
            (this._setMask(t - 1, e + i),
              this._setMask(t + 1, e - i),
              this._setMask(t - i, e - 1),
              this._setMask(t + i, e + 1));
        },
        _appendData: function (t, e, i, n) {
          var s,
            r,
            o,
            a = this._polynomial,
            h = this._stringBuffer;
          for (r = 0; r < n; r++) h[i + r] = 0;
          for (r = 0; r < e; r++) {
            if (255 !== (s = _.LOG[h[t + r] ^ h[i]]))
              for (o = 1; o < n; o++) h[i + o - 1] = h[i + o] ^ _.EXPONENT[v._modN(s + a[n - o])];
            else for (o = i; o < i + n; o++) h[o] = h[o + 1];
            h[i + n - 1] = 255 === s ? 0 : _.EXPONENT[v._modN(s + a[0])];
          }
        },
        _appendEccToData: function () {
          var t,
            e = 0,
            i = this._dataBlock,
            n = this._calculateMaxLength(),
            s = this._eccBlock;
          for (t = 0; t < this._neccBlock1; t++) (this._appendData(e, i, n, s), (e += i), (n += s));
          for (t = 0; t < this._neccBlock2; t++) (this._appendData(e, i + 1, n, s), (e += i + 1), (n += s));
        },
        _applyMask: function (t) {
          var e,
            i,
            n,
            s,
            r = this.buffer,
            o = this.width;
          switch (t) {
            case 0:
              for (s = 0; s < o; s++)
                for (n = 0; n < o; n++) (n + s) & 1 || this._isMasked(n, s) || (r[n + s * o] ^= 1);
              break;
            case 1:
              for (s = 0; s < o; s++) for (n = 0; n < o; n++) 1 & s || this._isMasked(n, s) || (r[n + s * o] ^= 1);
              break;
            case 2:
              for (s = 0; s < o; s++)
                for (e = 0, n = 0; n < o; n++, e++)
                  (3 === e && (e = 0), e || this._isMasked(n, s) || (r[n + s * o] ^= 1));
              break;
            case 3:
              for (i = 0, s = 0; s < o; s++, i++)
                for (3 === i && (i = 0), e = i, n = 0; n < o; n++, e++)
                  (3 === e && (e = 0), e || this._isMasked(n, s) || (r[n + s * o] ^= 1));
              break;
            case 4:
              for (s = 0; s < o; s++)
                for (e = 0, i = (s >> 1) & 1, n = 0; n < o; n++, e++)
                  (3 === e && ((e = 0), (i = !i)), i || this._isMasked(n, s) || (r[n + s * o] ^= 1));
              break;
            case 5:
              for (i = 0, s = 0; s < o; s++, i++)
                for (3 === i && (i = 0), e = 0, n = 0; n < o; n++, e++)
                  (3 === e && (e = 0), (n & s & 1) + !(!e | !i) || this._isMasked(n, s) || (r[n + s * o] ^= 1));
              break;
            case 6:
              for (i = 0, s = 0; s < o; s++, i++)
                for (3 === i && (i = 0), e = 0, n = 0; n < o; n++, e++)
                  (3 === e && (e = 0),
                    ((n & s & 1) + (e && e === i)) & 1 || this._isMasked(n, s) || (r[n + s * o] ^= 1));
              break;
            case 7:
              for (i = 0, s = 0; s < o; s++, i++)
                for (3 === i && (i = 0), e = 0, n = 0; n < o; n++, e++)
                  (3 === e && (e = 0),
                    ((e && e === i) + ((n + s) & 1)) & 1 || this._isMasked(n, s) || (r[n + s * o] ^= 1));
          }
        },
        _calculateMaxLength: function () {
          return this._dataBlock * (this._neccBlock1 + this._neccBlock2) + this._neccBlock2;
        },
        _calculatePolynomial: function () {
          var t,
            e,
            i = this._eccBlock,
            n = this._polynomial;
          for (n[0] = 1, t = 0; t < i; t++) {
            for (n[t + 1] = 1, e = t; e > 0; e--)
              n[e] = n[e] ? n[e - 1] ^ _.EXPONENT[v._modN(_.LOG[n[e]] + t)] : n[e - 1];
            n[0] = _.EXPONENT[v._modN(_.LOG[n[0]] + t)];
          }
          for (t = 0; t <= i; t++) n[t] = _.LOG[n[t]];
        },
        _checkBadness: function () {
          var t,
            e,
            i,
            n,
            s,
            r = 0,
            o = this._badness,
            a = this.buffer,
            h = this.width;
          for (s = 0; s < h - 1; s++)
            for (n = 0; n < h - 1; n++)
              ((a[n + h * s] && a[n + 1 + h * s] && a[n + h * (s + 1)] && a[n + 1 + h * (s + 1)]) ||
                !(a[n + h * s] || a[n + 1 + h * s] || a[n + h * (s + 1)] || a[n + 1 + h * (s + 1)])) &&
                (r += v.N2);
          var f = 0;
          for (s = 0; s < h; s++) {
            for (i = 0, o[0] = 0, t = 0, n = 0; n < h; n++)
              (t === (e = a[n + h * s]) ? o[i]++ : (o[++i] = 1), (f += (t = e) ? 1 : -1));
            r += this._getBadness(i);
          }
          f < 0 && (f = -f);
          var c = 0,
            u = f;
          for (u += u << 2, u <<= 1; u > h * h;) ((u -= h * h), c++);
          for (r += c * v.N4, n = 0; n < h; n++) {
            for (i = 0, o[0] = 0, t = 0, s = 0; s < h; s++) (t === (e = a[n + h * s]) ? o[i]++ : (o[++i] = 1), (t = e));
            r += this._getBadness(i);
          }
          return r;
        },
        _convertBitStream: function (t) {
          var e,
            i,
            n = this._ecc,
            s = this._version;
          for (i = 0; i < t; i++) n[i] = this._value.charCodeAt(i);
          var r = (this._stringBuffer = n.slice()),
            o = this._calculateMaxLength();
          t >= o - 2 && ((t = o - 2), s > 9 && t--);
          var a = t;
          if (s > 9) {
            for (r[a + 2] = 0, r[a + 3] = 0; a--;) ((e = r[a]), (r[a + 3] |= 255 & (e << 4)), (r[a + 2] = e >> 4));
            ((r[2] |= 255 & (t << 4)), (r[1] = t >> 4), (r[0] = 64 | (t >> 12)));
          } else {
            for (r[a + 1] = 0, r[a + 2] = 0; a--;) ((e = r[a]), (r[a + 2] |= 255 & (e << 4)), (r[a + 1] = e >> 4));
            ((r[1] |= 255 & (t << 4)), (r[0] = 64 | (t >> 4)));
          }
          for (a = t + 3 - (s < 10); a < o;) ((r[a++] = 236), (r[a++] = 17));
        },
        _getBadness: function (t) {
          var e,
            i = 0,
            n = this._badness;
          for (e = 0; e <= t; e++) n[e] >= 5 && (i += v.N1 + n[e] - 5);
          for (e = 3; e < t - 1; e += 2)
            n[e - 2] === n[e + 2] &&
              n[e + 2] === n[e - 1] &&
              n[e - 1] === n[e + 1] &&
              3 * n[e - 1] === n[e] &&
              (0 === n[e - 3] || e + 3 > t || 3 * n[e - 3] >= 4 * n[e] || 3 * n[e + 3] >= 4 * n[e]) &&
              (i += v.N3);
          return i;
        },
        _finish: function () {
          this._stringBuffer = this.buffer.slice();
          var t,
            e,
            i = 0,
            n = 3e4;
          for (e = 0; e < 8 && (this._applyMask(e), (t = this._checkBadness()) < n && ((n = t), (i = e)), 7 !== i); e++)
            this.buffer = this._stringBuffer.slice();
          (i !== e && this._applyMask(i), (n = l.FINAL_FORMAT[i + ((this._level - 1) << 3)]));
          var s = this.buffer,
            r = this.width;
          for (e = 0; e < 8; e++, n >>= 1)
            1 & n && ((s[r - 1 - e + 8 * r] = 1), e < 6 ? (s[8 + r * e] = 1) : (s[8 + r * (e + 1)] = 1));
          for (e = 0; e < 7; e++, n >>= 1)
            1 & n && ((s[8 + r * (r - 7 + e)] = 1), e ? (s[6 - e + 8 * r] = 1) : (s[7 + 8 * r] = 1));
        },
        _interleaveBlocks: function () {
          var t,
            e,
            i = this._dataBlock,
            n = this._ecc,
            s = this._eccBlock,
            r = 0,
            o = this._calculateMaxLength(),
            a = this._neccBlock1,
            h = this._neccBlock2,
            f = this._stringBuffer;
          for (t = 0; t < i; t++) {
            for (e = 0; e < a; e++) n[r++] = f[t + e * i];
            for (e = 0; e < h; e++) n[r++] = f[a * i + t + e * (i + 1)];
          }
          for (e = 0; e < h; e++) n[r++] = f[a * i + t + e * (i + 1)];
          for (t = 0; t < s; t++) for (e = 0; e < a + h; e++) n[r++] = f[o + t + e * s];
          this._stringBuffer = n;
        },
        _insertAlignments: function () {
          var t,
            e,
            i,
            n = this._version,
            s = this.width;
          if (n > 1)
            for (t = u.BLOCK[n], i = s - 7; ;) {
              for (e = s - 7; e > t - 3 && (this._addAlignment(e, i), !(e < t));) e -= t;
              if (i <= t + 9) break;
              ((i -= t), this._addAlignment(6, i), this._addAlignment(i, 6));
            }
        },
        _insertFinders: function () {
          var t,
            e,
            i,
            n,
            s = this.buffer,
            r = this.width;
          for (t = 0; t < 3; t++) {
            for (
              e = 0, n = 0, 1 === t && (e = r - 7), 2 === t && (n = r - 7), s[n + 3 + r * (e + 3)] = 1, i = 0;
              i < 6;
              i++
            )
              ((s[n + i + r * e] = 1),
                (s[n + r * (e + i + 1)] = 1),
                (s[n + 6 + r * (e + i)] = 1),
                (s[n + i + 1 + r * (e + 6)] = 1));
            for (i = 1; i < 5; i++)
              (this._setMask(n + i, e + 1),
                this._setMask(n + 1, e + i + 1),
                this._setMask(n + 5, e + i),
                this._setMask(n + i + 1, e + 5));
            for (i = 2; i < 4; i++)
              ((s[n + i + r * (e + 2)] = 1),
                (s[n + 2 + r * (e + i + 1)] = 1),
                (s[n + 4 + r * (e + i)] = 1),
                (s[n + i + 1 + r * (e + 4)] = 1));
          }
        },
        _insertTimingGap: function () {
          var t,
            e,
            i = this.width;
          for (e = 0; e < 7; e++) (this._setMask(7, e), this._setMask(i - 8, e), this._setMask(7, e + i - 7));
          for (t = 0; t < 8; t++) (this._setMask(t, 7), this._setMask(t + i - 8, 7), this._setMask(t, i - 8));
        },
        _insertTimingRowAndColumn: function () {
          var t,
            e = this.buffer,
            i = this.width;
          for (t = 0; t < i - 14; t++)
            1 & t
              ? (this._setMask(8 + t, 6), this._setMask(6, 8 + t))
              : ((e[8 + t + 6 * i] = 1), (e[6 + i * (8 + t)] = 1));
        },
        _insertVersion: function () {
          var t,
            e,
            i,
            n,
            s = this.buffer,
            r = this._version,
            o = this.width;
          if (r > 6)
            for (t = d.BLOCK[r - 7], e = 17, i = 0; i < 6; i++)
              for (n = 0; n < 3; n++, e--)
                1 & (e > 11 ? r >> (e - 12) : t >> e)
                  ? ((s[5 - i + o * (2 - n + o - 11)] = 1), (s[2 - n + o - 11 + o * (5 - i)] = 1))
                  : (this._setMask(5 - i, 2 - n + o - 11), this._setMask(2 - n + o - 11, 5 - i));
        },
        _isMasked: function (t, e) {
          var i = v._getMaskBit(t, e);
          return 1 === this._mask[i];
        },
        _pack: function () {
          var t,
            e,
            i,
            n = 1,
            s = 1,
            r = this.width,
            o = r - 1,
            a = r - 1,
            h = (this._dataBlock + this._eccBlock) * (this._neccBlock1 + this._neccBlock2) + this._neccBlock2;
          for (e = 0; e < h; e++)
            for (t = this._stringBuffer[e], i = 0; i < 8; i++, t <<= 1) {
              128 & t && (this.buffer[o + r * a] = 1);
              do {
                (s
                  ? o--
                  : (o++,
                    n
                      ? 0 !== a
                        ? a--
                        : ((n = !n), 6 === (o -= 2) && (o--, (a = 9)))
                      : a !== r - 1
                        ? a++
                        : ((n = !n), 6 === (o -= 2) && (o--, (a -= 8)))),
                  (s = !s));
              } while (this._isMasked(o, a));
            }
        },
        _reverseMask: function () {
          var t,
            e,
            i = this.width;
          for (t = 0; t < 9; t++) this._setMask(t, 8);
          for (t = 0; t < 8; t++) (this._setMask(t + i - 8, 8), this._setMask(8, t));
          for (e = 0; e < 7; e++) this._setMask(8, e + i - 7);
        },
        _setMask: function (t, e) {
          var i = v._getMaskBit(t, e);
          this._mask[i] = 1;
        },
        _syncMask: function () {
          var t,
            e,
            i = this.width;
          for (e = 0; e < i; e++) for (t = 0; t <= e; t++) this.buffer[t + i * e] && this._setMask(t, e);
        },
      },
      {
        _createArray: function (t) {
          var e,
            i = [];
          for (e = 0; e < t; e++) i[e] = 0;
          return i;
        },
        _getMaskBit: function (t, e) {
          var i;
          return (t > e && ((i = t), (t = e), (e = i)), (i = e), (i += e * e), (i >>= 1), (i += t));
        },
        _modN: function (t) {
          for (; t >= 255;) t = ((t -= 255) >> 8) + (255 & t);
          return t;
        },
        N1: 3,
        N2: 3,
        N3: 40,
        N4: 10,
      },
    ),
    p = v,
    m = f.extend({
      draw: function () {
        this.element.src = this.qrious.toDataURL();
      },
      reset: function () {
        this.element.src = "";
      },
      resize: function () {
        var t = this.element;
        t.width = t.height = this.qrious.size;
      },
    }),
    g = h.extend(
      function (t, e, i, n) {
        ((this.name = t), (this.modifiable = Boolean(e)), (this.defaultValue = i), (this._valueTransformer = n));
      },
      {
        transform: function (t) {
          var e = this._valueTransformer;
          return "function" == typeof e ? e(t, this) : t;
        },
      },
    ),
    k = h.extend(null, {
      abs: function (t) {
        return null != t ? Math.abs(t) : null;
      },
      hasOwn: function (t, e) {
        return Object.prototype.hasOwnProperty.call(t, e);
      },
      noop: function () {},
      toUpperCase: function (t) {
        return null != t ? t.toUpperCase() : null;
      },
    }),
    w = h.extend(
      function (t) {
        ((this.options = {}),
          t.forEach(function (t) {
            this.options[t.name] = t;
          }, this));
      },
      {
        exists: function (t) {
          return null != this.options[t];
        },
        get: function (t, e) {
          return w._get(this.options[t], e);
        },
        getAll: function (t) {
          var e,
            i = this.options,
            n = {};
          for (e in i) k.hasOwn(i, e) && (n[e] = w._get(i[e], t));
          return n;
        },
        init: function (t, e, i) {
          "function" != typeof i && (i = k.noop);
          var n, s;
          for (n in this.options)
            k.hasOwn(this.options, n) &&
              ((s = this.options[n]), w._set(s, s.defaultValue, e), w._createAccessor(s, e, i));
          this._setAll(t, e, !0);
        },
        set: function (t, e, i) {
          return this._set(t, e, i);
        },
        setAll: function (t, e) {
          return this._setAll(t, e);
        },
        _set: function (t, e, i, n) {
          var s = this.options[t];
          if (!s) throw new Error("Invalid option: " + t);
          if (!s.modifiable && !n) throw new Error("Option cannot be modified: " + t);
          return w._set(s, e, i);
        },
        _setAll: function (t, e, i) {
          if (!t) return !1;
          var n,
            s = !1;
          for (n in t) k.hasOwn(t, n) && this._set(n, t[n], e, i) && (s = !0);
          return s;
        },
      },
      {
        _createAccessor: function (t, e, i) {
          var n = {
            get: function () {
              return w._get(t, e);
            },
          };
          (t.modifiable &&
            (n.set = function (n) {
              w._set(t, n, e) && i(n, t);
            }),
            Object.defineProperty(e, t.name, n));
        },
        _get: function (t, e) {
          return e["_" + t.name];
        },
        _set: function (t, e, i) {
          var n = "_" + t.name,
            s = i[n],
            r = t.transform(null != e ? e : t.defaultValue);
          return ((i[n] = r), r !== s);
        },
      },
    ),
    M = w,
    b = h.extend(
      function () {
        this._services = {};
      },
      {
        getService: function (t) {
          var e = this._services[t];
          if (!e) throw new Error("Service is not being managed with name: " + t);
          return e;
        },
        setService: function (t, e) {
          if (this._services[t]) throw new Error("Service is already managed with name: " + t);
          e && (this._services[t] = e);
        },
      },
    ),
    B = new M([
      new g("background", !0, "white"),
      new g("backgroundAlpha", !0, 1, k.abs),
      new g("element"),
      new g("foreground", !0, "black"),
      new g("foregroundAlpha", !0, 1, k.abs),
      new g("level", !0, "L", k.toUpperCase),
      new g("mime", !0, "image/png"),
      new g("padding", !0, null, k.abs),
      new g("size", !0, 100, k.abs),
      new g("value", !0, ""),
    ]),
    y = new b(),
    O = h.extend(
      function (t) {
        B.init(t, this, this.update.bind(this));
        var e = B.get("element", this),
          i = y.getService("element"),
          n = e && i.isCanvas(e) ? e : i.createCanvas(),
          s = e && i.isImage(e) ? e : i.createImage();
        ((this._canvasRenderer = new c(this, n, !0)), (this._imageRenderer = new m(this, s, s === e)), this.update());
      },
      {
        get: function () {
          return B.getAll(this);
        },
        set: function (t) {
          B.setAll(t, this) && this.update();
        },
        toDataURL: function (t) {
          return this.canvas.toDataURL(t || this.mime);
        },
        update: function () {
          var t = new p({ level: this.level, value: this.value });
          (this._canvasRenderer.render(t), this._imageRenderer.render(t));
        },
      },
      {
        use: function (t) {
          y.setService(t.getName(), t);
        },
      },
    );
  Object.defineProperties(O.prototype, {
    canvas: {
      get: function () {
        return this._canvasRenderer.getElement();
      },
    },
    image: {
      get: function () {
        return this._imageRenderer.getElement();
      },
    },
  });
  var A = O,
    L = h
      .extend({ getName: function () {} })
      .extend({
        createCanvas: function () {},
        createImage: function () {},
        getName: function () {
          return "element";
        },
        isCanvas: function (t) {},
        isImage: function (t) {},
      })
      .extend({
        createCanvas: function () {
          return document.createElement("canvas");
        },
        createImage: function () {
          return document.createElement("img");
        },
        isCanvas: function (t) {
          return t instanceof HTMLCanvasElement;
        },
        isImage: function (t) {
          return t instanceof HTMLImageElement;
        },
      });
  return (A.use(new L()), A);
});
/*!
 * Packery PACKAGED v2.1.2
 * Gapless, draggable grid layouts
 *
 * Licensed GPLv3 for open source use
 * or Packery Commercial License for commercial use
 *
 * http://packery.metafizzy.co
 * Copyright 2013-2018 Metafizzy
 */
(!(function (t, e) {
  "function" == typeof define && define.amd
    ? define("jquery-bridget/jquery-bridget", ["jquery"], function (i) {
        return e(t, i);
      })
    : "object" == typeof module && module.exports
      ? (module.exports = e(t, require("jquery")))
      : (t.jQueryBridget = e(t, t.jQuery));
})(window, function (t, e) {
  "use strict";
  function i(i, s, a) {
    function h(t, e, n) {
      var o,
        s = "$()." + i + '("' + e + '")';
      return (
        t.each(function (t, h) {
          var u = a.data(h, i);
          if (!u) return void r(i + " not initialized. Cannot call methods, i.e. " + s);
          var c = u[e];
          if (!c || "_" == e.charAt(0)) return void r(s + " is not a valid method");
          var d = c.apply(u, n);
          o = void 0 === o ? d : o;
        }),
        void 0 !== o ? o : t
      );
    }
    function u(t, e) {
      t.each(function (t, n) {
        var o = a.data(n, i);
        o ? (o.option(e), o._init()) : ((o = new s(n, e)), a.data(n, i, o));
      });
    }
    ((a = a || e || t.jQuery),
      a &&
        (s.prototype.option ||
          (s.prototype.option = function (t) {
            a.isPlainObject(t) && (this.options = a.extend(!0, this.options, t));
          }),
        (a.fn[i] = function (t) {
          if ("string" == typeof t) {
            var e = o.call(arguments, 1);
            return h(this, t, e);
          }
          return (u(this, t), this);
        }),
        n(a)));
  }
  function n(t) {
    !t || (t && t.bridget) || (t.bridget = i);
  }
  var o = Array.prototype.slice,
    s = t.console,
    r =
      "undefined" == typeof s
        ? function () {}
        : function (t) {
            s.error(t);
          };
  return (n(e || t.jQuery), i);
}),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define("get-size/get-size", e)
      : "object" == typeof module && module.exports
        ? (module.exports = e())
        : (t.getSize = e());
  })(window, function () {
    "use strict";
    function t(t) {
      var e = parseFloat(t),
        i = -1 == t.indexOf("%") && !isNaN(e);
      return i && e;
    }
    function e() {}
    function i() {
      for (
        var t = { width: 0, height: 0, innerWidth: 0, innerHeight: 0, outerWidth: 0, outerHeight: 0 }, e = 0;
        u > e;
        e++
      ) {
        var i = h[e];
        t[i] = 0;
      }
      return t;
    }
    function n(t) {
      var e = getComputedStyle(t);
      return (
        e ||
          a(
            "Style returned " +
              e +
              ". Are you running this code in a hidden iframe on Firefox? See https://bit.ly/getsizebug1",
          ),
        e
      );
    }
    function o() {
      if (!c) {
        c = !0;
        var e = document.createElement("div");
        ((e.style.width = "200px"),
          (e.style.padding = "1px 2px 3px 4px"),
          (e.style.borderStyle = "solid"),
          (e.style.borderWidth = "1px 2px 3px 4px"),
          (e.style.boxSizing = "border-box"));
        var i = document.body || document.documentElement;
        i.appendChild(e);
        var o = n(e);
        ((r = 200 == Math.round(t(o.width))), (s.isBoxSizeOuter = r), i.removeChild(e));
      }
    }
    function s(e) {
      if ((o(), "string" == typeof e && (e = document.querySelector(e)), e && "object" == typeof e && e.nodeType)) {
        var s = n(e);
        if ("none" == s.display) return i();
        var a = {};
        ((a.width = e.offsetWidth), (a.height = e.offsetHeight));
        for (var c = (a.isBorderBox = "border-box" == s.boxSizing), d = 0; u > d; d++) {
          var l = h[d],
            f = s[l],
            p = parseFloat(f);
          a[l] = isNaN(p) ? 0 : p;
        }
        var g = a.paddingLeft + a.paddingRight,
          m = a.paddingTop + a.paddingBottom,
          y = a.marginLeft + a.marginRight,
          v = a.marginTop + a.marginBottom,
          _ = a.borderLeftWidth + a.borderRightWidth,
          x = a.borderTopWidth + a.borderBottomWidth,
          b = c && r,
          E = t(s.width);
        E !== !1 && (a.width = E + (b ? 0 : g + _));
        var w = t(s.height);
        return (
          w !== !1 && (a.height = w + (b ? 0 : m + x)),
          (a.innerWidth = a.width - (g + _)),
          (a.innerHeight = a.height - (m + x)),
          (a.outerWidth = a.width + y),
          (a.outerHeight = a.height + v),
          a
        );
      }
    }
    var r,
      a =
        "undefined" == typeof console
          ? e
          : function (t) {
              console.error(t);
            },
      h = [
        "paddingLeft",
        "paddingRight",
        "paddingTop",
        "paddingBottom",
        "marginLeft",
        "marginRight",
        "marginTop",
        "marginBottom",
        "borderLeftWidth",
        "borderRightWidth",
        "borderTopWidth",
        "borderBottomWidth",
      ],
      u = h.length,
      c = !1;
    return s;
  }),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define("ev-emitter/ev-emitter", e)
      : "object" == typeof module && module.exports
        ? (module.exports = e())
        : (t.EvEmitter = e());
  })("undefined" != typeof window ? window : this, function () {
    function t() {}
    var e = t.prototype;
    return (
      (e.on = function (t, e) {
        if (t && e) {
          var i = (this._events = this._events || {}),
            n = (i[t] = i[t] || []);
          return (-1 == n.indexOf(e) && n.push(e), this);
        }
      }),
      (e.once = function (t, e) {
        if (t && e) {
          this.on(t, e);
          var i = (this._onceEvents = this._onceEvents || {}),
            n = (i[t] = i[t] || {});
          return ((n[e] = !0), this);
        }
      }),
      (e.off = function (t, e) {
        var i = this._events && this._events[t];
        if (i && i.length) {
          var n = i.indexOf(e);
          return (-1 != n && i.splice(n, 1), this);
        }
      }),
      (e.emitEvent = function (t, e) {
        var i = this._events && this._events[t];
        if (i && i.length) {
          ((i = i.slice(0)), (e = e || []));
          for (var n = this._onceEvents && this._onceEvents[t], o = 0; o < i.length; o++) {
            var s = i[o],
              r = n && n[s];
            (r && (this.off(t, s), delete n[s]), s.apply(this, e));
          }
          return this;
        }
      }),
      (e.allOff = function () {
        (delete this._events, delete this._onceEvents);
      }),
      t
    );
  }),
  (function (t, e) {
    "use strict";
    "function" == typeof define && define.amd
      ? define("desandro-matches-selector/matches-selector", e)
      : "object" == typeof module && module.exports
        ? (module.exports = e())
        : (t.matchesSelector = e());
  })(window, function () {
    "use strict";
    var t = (function () {
      var t = window.Element.prototype;
      if (t.matches) return "matches";
      if (t.matchesSelector) return "matchesSelector";
      for (var e = ["webkit", "moz", "ms", "o"], i = 0; i < e.length; i++) {
        var n = e[i],
          o = n + "MatchesSelector";
        if (t[o]) return o;
      }
    })();
    return function (e, i) {
      return e[t](i);
    };
  }),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define("fizzy-ui-utils/utils", ["desandro-matches-selector/matches-selector"], function (i) {
          return e(t, i);
        })
      : "object" == typeof module && module.exports
        ? (module.exports = e(t, require("desandro-matches-selector")))
        : (t.fizzyUIUtils = e(t, t.matchesSelector));
  })(window, function (t, e) {
    var i = {};
    ((i.extend = function (t, e) {
      for (var i in e) t[i] = e[i];
      return t;
    }),
      (i.modulo = function (t, e) {
        return ((t % e) + e) % e;
      }));
    var n = Array.prototype.slice;
    ((i.makeArray = function (t) {
      if (Array.isArray(t)) return t;
      if (null === t || void 0 === t) return [];
      var e = "object" == typeof t && "number" == typeof t.length;
      return e ? n.call(t) : [t];
    }),
      (i.removeFrom = function (t, e) {
        var i = t.indexOf(e);
        -1 != i && t.splice(i, 1);
      }),
      (i.getParent = function (t, i) {
        for (; t.parentNode && t != document.body;) if (((t = t.parentNode), e(t, i))) return t;
      }),
      (i.getQueryElement = function (t) {
        return "string" == typeof t ? document.querySelector(t) : t;
      }),
      (i.handleEvent = function (t) {
        var e = "on" + t.type;
        this[e] && this[e](t);
      }),
      (i.filterFindElements = function (t, n) {
        t = i.makeArray(t);
        var o = [];
        return (
          t.forEach(function (t) {
            if (t instanceof HTMLElement) {
              if (!n) return void o.push(t);
              e(t, n) && o.push(t);
              for (var i = t.querySelectorAll(n), s = 0; s < i.length; s++) o.push(i[s]);
            }
          }),
          o
        );
      }),
      (i.debounceMethod = function (t, e, i) {
        i = i || 100;
        var n = t.prototype[e],
          o = e + "Timeout";
        t.prototype[e] = function () {
          var t = this[o];
          clearTimeout(t);
          var e = arguments,
            s = this;
          this[o] = setTimeout(function () {
            (n.apply(s, e), delete s[o]);
          }, i);
        };
      }),
      (i.docReady = function (t) {
        var e = document.readyState;
        "complete" == e || "interactive" == e ? setTimeout(t) : document.addEventListener("DOMContentLoaded", t);
      }),
      (i.toDashed = function (t) {
        return t
          .replace(/(.)([A-Z])/g, function (t, e, i) {
            return e + "-" + i;
          })
          .toLowerCase();
      }));
    var o = t.console;
    return (
      (i.htmlInit = function (e, n) {
        i.docReady(function () {
          var s = i.toDashed(n),
            r = "data-" + s,
            a = document.querySelectorAll("[" + r + "]"),
            h = document.querySelectorAll(".js-" + s),
            u = i.makeArray(a).concat(i.makeArray(h)),
            c = r + "-options",
            d = t.jQuery;
          u.forEach(function (t) {
            var i,
              s = t.getAttribute(r) || t.getAttribute(c);
            try {
              i = s && JSON.parse(s);
            } catch (a) {
              return void (o && o.error("Error parsing " + r + " on " + t.className + ": " + a));
            }
            var h = new e(t, i);
            d && d.data(t, n, h);
          });
        });
      }),
      i
    );
  }),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define("outlayer/item", ["ev-emitter/ev-emitter", "get-size/get-size"], e)
      : "object" == typeof module && module.exports
        ? (module.exports = e(require("ev-emitter"), require("get-size")))
        : ((t.Outlayer = {}), (t.Outlayer.Item = e(t.EvEmitter, t.getSize)));
  })(window, function (t, e) {
    "use strict";
    function i(t) {
      for (var e in t) return !1;
      return ((e = null), !0);
    }
    function n(t, e) {
      t && ((this.element = t), (this.layout = e), (this.position = { x: 0, y: 0 }), this._create());
    }
    function o(t) {
      return t.replace(/([A-Z])/g, function (t) {
        return "-" + t.toLowerCase();
      });
    }
    var s = document.documentElement.style,
      r = "string" == typeof s.transition ? "transition" : "WebkitTransition",
      a = "string" == typeof s.transform ? "transform" : "WebkitTransform",
      h = { WebkitTransition: "webkitTransitionEnd", transition: "transitionend" }[r],
      u = {
        transform: a,
        transition: r,
        transitionDuration: r + "Duration",
        transitionProperty: r + "Property",
        transitionDelay: r + "Delay",
      },
      c = (n.prototype = Object.create(t.prototype));
    ((c.constructor = n),
      (c._create = function () {
        ((this._transn = { ingProperties: {}, clean: {}, onEnd: {} }), this.css({ position: "absolute" }));
      }),
      (c.handleEvent = function (t) {
        var e = "on" + t.type;
        this[e] && this[e](t);
      }),
      (c.getSize = function () {
        this.size = e(this.element);
      }),
      (c.css = function (t) {
        var e = this.element.style;
        for (var i in t) {
          var n = u[i] || i;
          e[n] = t[i];
        }
      }),
      (c.getPosition = function () {
        var t = getComputedStyle(this.element),
          e = this.layout._getOption("originLeft"),
          i = this.layout._getOption("originTop"),
          n = t[e ? "left" : "right"],
          o = t[i ? "top" : "bottom"],
          s = parseFloat(n),
          r = parseFloat(o),
          a = this.layout.size;
        (-1 != n.indexOf("%") && (s = (s / 100) * a.width),
          -1 != o.indexOf("%") && (r = (r / 100) * a.height),
          (s = isNaN(s) ? 0 : s),
          (r = isNaN(r) ? 0 : r),
          (s -= e ? a.paddingLeft : a.paddingRight),
          (r -= i ? a.paddingTop : a.paddingBottom),
          (this.position.x = s),
          (this.position.y = r));
      }),
      (c.layoutPosition = function () {
        var t = this.layout.size,
          e = {},
          i = this.layout._getOption("originLeft"),
          n = this.layout._getOption("originTop"),
          o = i ? "paddingLeft" : "paddingRight",
          s = i ? "left" : "right",
          r = i ? "right" : "left",
          a = this.position.x + t[o];
        ((e[s] = this.getXValue(a)), (e[r] = ""));
        var h = n ? "paddingTop" : "paddingBottom",
          u = n ? "top" : "bottom",
          c = n ? "bottom" : "top",
          d = this.position.y + t[h];
        ((e[u] = this.getYValue(d)), (e[c] = ""), this.css(e), this.emitEvent("layout", [this]));
      }),
      (c.getXValue = function (t) {
        var e = this.layout._getOption("horizontal");
        return this.layout.options.percentPosition && !e ? (t / this.layout.size.width) * 100 + "%" : t + "px";
      }),
      (c.getYValue = function (t) {
        var e = this.layout._getOption("horizontal");
        return this.layout.options.percentPosition && e ? (t / this.layout.size.height) * 100 + "%" : t + "px";
      }),
      (c._transitionTo = function (t, e) {
        this.getPosition();
        var i = this.position.x,
          n = this.position.y,
          o = t == this.position.x && e == this.position.y;
        if ((this.setPosition(t, e), o && !this.isTransitioning)) return void this.layoutPosition();
        var s = t - i,
          r = e - n,
          a = {};
        ((a.transform = this.getTranslate(s, r)),
          this.transition({ to: a, onTransitionEnd: { transform: this.layoutPosition }, isCleaning: !0 }));
      }),
      (c.getTranslate = function (t, e) {
        var i = this.layout._getOption("originLeft"),
          n = this.layout._getOption("originTop");
        return ((t = i ? t : -t), (e = n ? e : -e), "translate3d(" + t + "px, " + e + "px, 0)");
      }),
      (c.goTo = function (t, e) {
        (this.setPosition(t, e), this.layoutPosition());
      }),
      (c.moveTo = c._transitionTo),
      (c.setPosition = function (t, e) {
        ((this.position.x = parseFloat(t)), (this.position.y = parseFloat(e)));
      }),
      (c._nonTransition = function (t) {
        (this.css(t.to), t.isCleaning && this._removeStyles(t.to));
        for (var e in t.onTransitionEnd) t.onTransitionEnd[e].call(this);
      }),
      (c.transition = function (t) {
        if (!parseFloat(this.layout.options.transitionDuration)) return void this._nonTransition(t);
        var e = this._transn;
        for (var i in t.onTransitionEnd) e.onEnd[i] = t.onTransitionEnd[i];
        for (i in t.to) ((e.ingProperties[i] = !0), t.isCleaning && (e.clean[i] = !0));
        if (t.from) {
          this.css(t.from);
          var n = this.element.offsetHeight;
          n = null;
        }
        (this.enableTransition(t.to), this.css(t.to), (this.isTransitioning = !0));
      }));
    var d = "opacity," + o(a);
    ((c.enableTransition = function () {
      if (!this.isTransitioning) {
        var t = this.layout.options.transitionDuration;
        ((t = "number" == typeof t ? t + "ms" : t),
          this.css({ transitionProperty: d, transitionDuration: t, transitionDelay: this.staggerDelay || 0 }),
          this.element.addEventListener(h, this, !1));
      }
    }),
      (c.onwebkitTransitionEnd = function (t) {
        this.ontransitionend(t);
      }),
      (c.onotransitionend = function (t) {
        this.ontransitionend(t);
      }));
    var l = { "-webkit-transform": "transform" };
    ((c.ontransitionend = function (t) {
      if (t.target === this.element) {
        var e = this._transn,
          n = l[t.propertyName] || t.propertyName;
        if (
          (delete e.ingProperties[n],
          i(e.ingProperties) && this.disableTransition(),
          n in e.clean && ((this.element.style[t.propertyName] = ""), delete e.clean[n]),
          n in e.onEnd)
        ) {
          var o = e.onEnd[n];
          (o.call(this), delete e.onEnd[n]);
        }
        this.emitEvent("transitionEnd", [this]);
      }
    }),
      (c.disableTransition = function () {
        (this.removeTransitionStyles(), this.element.removeEventListener(h, this, !1), (this.isTransitioning = !1));
      }),
      (c._removeStyles = function (t) {
        var e = {};
        for (var i in t) e[i] = "";
        this.css(e);
      }));
    var f = { transitionProperty: "", transitionDuration: "", transitionDelay: "" };
    return (
      (c.removeTransitionStyles = function () {
        this.css(f);
      }),
      (c.stagger = function (t) {
        ((t = isNaN(t) ? 0 : t), (this.staggerDelay = t + "ms"));
      }),
      (c.removeElem = function () {
        (this.element.parentNode.removeChild(this.element),
          this.css({ display: "" }),
          this.emitEvent("remove", [this]));
      }),
      (c.remove = function () {
        return r && parseFloat(this.layout.options.transitionDuration)
          ? (this.once("transitionEnd", function () {
              this.removeElem();
            }),
            void this.hide())
          : void this.removeElem();
      }),
      (c.reveal = function () {
        (delete this.isHidden, this.css({ display: "" }));
        var t = this.layout.options,
          e = {},
          i = this.getHideRevealTransitionEndProperty("visibleStyle");
        ((e[i] = this.onRevealTransitionEnd),
          this.transition({ from: t.hiddenStyle, to: t.visibleStyle, isCleaning: !0, onTransitionEnd: e }));
      }),
      (c.onRevealTransitionEnd = function () {
        this.isHidden || this.emitEvent("reveal");
      }),
      (c.getHideRevealTransitionEndProperty = function (t) {
        var e = this.layout.options[t];
        if (e.opacity) return "opacity";
        for (var i in e) return i;
      }),
      (c.hide = function () {
        ((this.isHidden = !0), this.css({ display: "" }));
        var t = this.layout.options,
          e = {},
          i = this.getHideRevealTransitionEndProperty("hiddenStyle");
        ((e[i] = this.onHideTransitionEnd),
          this.transition({ from: t.visibleStyle, to: t.hiddenStyle, isCleaning: !0, onTransitionEnd: e }));
      }),
      (c.onHideTransitionEnd = function () {
        this.isHidden && (this.css({ display: "none" }), this.emitEvent("hide"));
      }),
      (c.destroy = function () {
        this.css({ position: "", left: "", right: "", top: "", bottom: "", transition: "", transform: "" });
      }),
      n
    );
  }),
  (function (t, e) {
    "use strict";
    "function" == typeof define && define.amd
      ? define(
          "outlayer/outlayer",
          ["ev-emitter/ev-emitter", "get-size/get-size", "fizzy-ui-utils/utils", "./item"],
          function (i, n, o, s) {
            return e(t, i, n, o, s);
          },
        )
      : "object" == typeof module && module.exports
        ? (module.exports = e(
            t,
            require("ev-emitter"),
            require("get-size"),
            require("fizzy-ui-utils"),
            require("./item"),
          ))
        : (t.Outlayer = e(t, t.EvEmitter, t.getSize, t.fizzyUIUtils, t.Outlayer.Item));
  })(window, function (t, e, i, n, o) {
    "use strict";
    function s(t, e) {
      var i = n.getQueryElement(t);
      if (!i) return void (h && h.error("Bad element for " + this.constructor.namespace + ": " + (i || t)));
      ((this.element = i),
        u && (this.$element = u(this.element)),
        (this.options = n.extend({}, this.constructor.defaults)),
        this.option(e));
      var o = ++d;
      ((this.element.outlayerGUID = o), (l[o] = this), this._create());
      var s = this._getOption("initLayout");
      s && this.layout();
    }
    function r(t) {
      function e() {
        t.apply(this, arguments);
      }
      return ((e.prototype = Object.create(t.prototype)), (e.prototype.constructor = e), e);
    }
    function a(t) {
      if ("number" == typeof t) return t;
      var e = t.match(/(^\d*\.?\d*)(\w*)/),
        i = e && e[1],
        n = e && e[2];
      if (!i.length) return 0;
      i = parseFloat(i);
      var o = p[n] || 1;
      return i * o;
    }
    var h = t.console,
      u = t.jQuery,
      c = function () {},
      d = 0,
      l = {};
    ((s.namespace = "outlayer"),
      (s.Item = o),
      (s.defaults = {
        containerStyle: { position: "relative" },
        initLayout: !0,
        originLeft: !0,
        originTop: !0,
        resize: !0,
        resizeContainer: !0,
        transitionDuration: "0.4s",
        hiddenStyle: { opacity: 0, transform: "scale(0.001)" },
        visibleStyle: { opacity: 1, transform: "scale(1)" },
      }));
    var f = s.prototype;
    (n.extend(f, e.prototype),
      (f.option = function (t) {
        n.extend(this.options, t);
      }),
      (f._getOption = function (t) {
        var e = this.constructor.compatOptions[t];
        return e && void 0 !== this.options[e] ? this.options[e] : this.options[t];
      }),
      (s.compatOptions = {
        initLayout: "isInitLayout",
        horizontal: "isHorizontal",
        layoutInstant: "isLayoutInstant",
        originLeft: "isOriginLeft",
        originTop: "isOriginTop",
        resize: "isResizeBound",
        resizeContainer: "isResizingContainer",
      }),
      (f._create = function () {
        (this.reloadItems(),
          (this.stamps = []),
          this.stamp(this.options.stamp),
          n.extend(this.element.style, this.options.containerStyle));
        var t = this._getOption("resize");
        t && this.bindResize();
      }),
      (f.reloadItems = function () {
        this.items = this._itemize(this.element.children);
      }),
      (f._itemize = function (t) {
        for (var e = this._filterFindItemElements(t), i = this.constructor.Item, n = [], o = 0; o < e.length; o++) {
          var s = e[o],
            r = new i(s, this);
          n.push(r);
        }
        return n;
      }),
      (f._filterFindItemElements = function (t) {
        return n.filterFindElements(t, this.options.itemSelector);
      }),
      (f.getItemElements = function () {
        return this.items.map(function (t) {
          return t.element;
        });
      }),
      (f.layout = function () {
        (this._resetLayout(), this._manageStamps());
        var t = this._getOption("layoutInstant"),
          e = void 0 !== t ? t : !this._isLayoutInited;
        (this.layoutItems(this.items, e), (this._isLayoutInited = !0));
      }),
      (f._init = f.layout),
      (f._resetLayout = function () {
        this.getSize();
      }),
      (f.getSize = function () {
        this.size = i(this.element);
      }),
      (f._getMeasurement = function (t, e) {
        var n,
          o = this.options[t];
        o
          ? ("string" == typeof o ? (n = this.element.querySelector(o)) : o instanceof HTMLElement && (n = o),
            (this[t] = n ? i(n)[e] : o))
          : (this[t] = 0);
      }),
      (f.layoutItems = function (t, e) {
        ((t = this._getItemsForLayout(t)), this._layoutItems(t, e), this._postLayout());
      }),
      (f._getItemsForLayout = function (t) {
        return t.filter(function (t) {
          return !t.isIgnored;
        });
      }),
      (f._layoutItems = function (t, e) {
        if ((this._emitCompleteOnItems("layout", t), t && t.length)) {
          var i = [];
          (t.forEach(function (t) {
            var n = this._getItemLayoutPosition(t);
            ((n.item = t), (n.isInstant = e || t.isLayoutInstant), i.push(n));
          }, this),
            this._processLayoutQueue(i));
        }
      }),
      (f._getItemLayoutPosition = function () {
        return { x: 0, y: 0 };
      }),
      (f._processLayoutQueue = function (t) {
        (this.updateStagger(),
          t.forEach(function (t, e) {
            this._positionItem(t.item, t.x, t.y, t.isInstant, e);
          }, this));
      }),
      (f.updateStagger = function () {
        var t = this.options.stagger;
        return null === t || void 0 === t ? void (this.stagger = 0) : ((this.stagger = a(t)), this.stagger);
      }),
      (f._positionItem = function (t, e, i, n, o) {
        n ? t.goTo(e, i) : (t.stagger(o * this.stagger), t.moveTo(e, i));
      }),
      (f._postLayout = function () {
        this.resizeContainer();
      }),
      (f.resizeContainer = function () {
        var t = this._getOption("resizeContainer");
        if (t) {
          var e = this._getContainerSize();
          e && (this._setContainerMeasure(e.width, !0), this._setContainerMeasure(e.height, !1));
        }
      }),
      (f._getContainerSize = c),
      (f._setContainerMeasure = function (t, e) {
        if (void 0 !== t) {
          var i = this.size;
          (i.isBorderBox &&
            (t += e
              ? i.paddingLeft + i.paddingRight + i.borderLeftWidth + i.borderRightWidth
              : i.paddingBottom + i.paddingTop + i.borderTopWidth + i.borderBottomWidth),
            (t = Math.max(t, 0)),
            (this.element.style[e ? "width" : "height"] = t + "px"));
        }
      }),
      (f._emitCompleteOnItems = function (t, e) {
        function i() {
          o.dispatchEvent(t + "Complete", null, [e]);
        }
        function n() {
          (r++, r == s && i());
        }
        var o = this,
          s = e.length;
        if (!e || !s) return void i();
        var r = 0;
        e.forEach(function (e) {
          e.once(t, n);
        });
      }),
      (f.dispatchEvent = function (t, e, i) {
        var n = e ? [e].concat(i) : i;
        if ((this.emitEvent(t, n), u))
          if (((this.$element = this.$element || u(this.element)), e)) {
            var o = u.Event(e);
            ((o.type = t), this.$element.trigger(o, i));
          } else this.$element.trigger(t, i);
      }),
      (f.ignore = function (t) {
        var e = this.getItem(t);
        e && (e.isIgnored = !0);
      }),
      (f.unignore = function (t) {
        var e = this.getItem(t);
        e && delete e.isIgnored;
      }),
      (f.stamp = function (t) {
        ((t = this._find(t)), t && ((this.stamps = this.stamps.concat(t)), t.forEach(this.ignore, this)));
      }),
      (f.unstamp = function (t) {
        ((t = this._find(t)),
          t &&
            t.forEach(function (t) {
              (n.removeFrom(this.stamps, t), this.unignore(t));
            }, this));
      }),
      (f._find = function (t) {
        return t ? ("string" == typeof t && (t = this.element.querySelectorAll(t)), (t = n.makeArray(t))) : void 0;
      }),
      (f._manageStamps = function () {
        this.stamps && this.stamps.length && (this._getBoundingRect(), this.stamps.forEach(this._manageStamp, this));
      }),
      (f._getBoundingRect = function () {
        var t = this.element.getBoundingClientRect(),
          e = this.size;
        this._boundingRect = {
          left: t.left + e.paddingLeft + e.borderLeftWidth,
          top: t.top + e.paddingTop + e.borderTopWidth,
          right: t.right - (e.paddingRight + e.borderRightWidth),
          bottom: t.bottom - (e.paddingBottom + e.borderBottomWidth),
        };
      }),
      (f._manageStamp = c),
      (f._getElementOffset = function (t) {
        var e = t.getBoundingClientRect(),
          n = this._boundingRect,
          o = i(t),
          s = {
            left: e.left - n.left - o.marginLeft,
            top: e.top - n.top - o.marginTop,
            right: n.right - e.right - o.marginRight,
            bottom: n.bottom - e.bottom - o.marginBottom,
          };
        return s;
      }),
      (f.handleEvent = n.handleEvent),
      (f.bindResize = function () {
        (t.addEventListener("resize", this), (this.isResizeBound = !0));
      }),
      (f.unbindResize = function () {
        (t.removeEventListener("resize", this), (this.isResizeBound = !1));
      }),
      (f.onresize = function () {
        this.resize();
      }),
      n.debounceMethod(s, "onresize", 100),
      (f.resize = function () {
        this.isResizeBound && this.needsResizeLayout() && this.layout();
      }),
      (f.needsResizeLayout = function () {
        var t = i(this.element),
          e = this.size && t;
        return e && t.innerWidth !== this.size.innerWidth;
      }),
      (f.addItems = function (t) {
        var e = this._itemize(t);
        return (e.length && (this.items = this.items.concat(e)), e);
      }),
      (f.appended = function (t) {
        var e = this.addItems(t);
        e.length && (this.layoutItems(e, !0), this.reveal(e));
      }),
      (f.prepended = function (t) {
        var e = this._itemize(t);
        if (e.length) {
          var i = this.items.slice(0);
          ((this.items = e.concat(i)),
            this._resetLayout(),
            this._manageStamps(),
            this.layoutItems(e, !0),
            this.reveal(e),
            this.layoutItems(i));
        }
      }),
      (f.reveal = function (t) {
        if ((this._emitCompleteOnItems("reveal", t), t && t.length)) {
          var e = this.updateStagger();
          t.forEach(function (t, i) {
            (t.stagger(i * e), t.reveal());
          });
        }
      }),
      (f.hide = function (t) {
        if ((this._emitCompleteOnItems("hide", t), t && t.length)) {
          var e = this.updateStagger();
          t.forEach(function (t, i) {
            (t.stagger(i * e), t.hide());
          });
        }
      }),
      (f.revealItemElements = function (t) {
        var e = this.getItems(t);
        this.reveal(e);
      }),
      (f.hideItemElements = function (t) {
        var e = this.getItems(t);
        this.hide(e);
      }),
      (f.getItem = function (t) {
        for (var e = 0; e < this.items.length; e++) {
          var i = this.items[e];
          if (i.element == t) return i;
        }
      }),
      (f.getItems = function (t) {
        t = n.makeArray(t);
        var e = [];
        return (
          t.forEach(function (t) {
            var i = this.getItem(t);
            i && e.push(i);
          }, this),
          e
        );
      }),
      (f.remove = function (t) {
        var e = this.getItems(t);
        (this._emitCompleteOnItems("remove", e),
          e &&
            e.length &&
            e.forEach(function (t) {
              (t.remove(), n.removeFrom(this.items, t));
            }, this));
      }),
      (f.destroy = function () {
        var t = this.element.style;
        ((t.height = ""),
          (t.position = ""),
          (t.width = ""),
          this.items.forEach(function (t) {
            t.destroy();
          }),
          this.unbindResize());
        var e = this.element.outlayerGUID;
        (delete l[e], delete this.element.outlayerGUID, u && u.removeData(this.element, this.constructor.namespace));
      }),
      (s.data = function (t) {
        t = n.getQueryElement(t);
        var e = t && t.outlayerGUID;
        return e && l[e];
      }),
      (s.create = function (t, e) {
        var i = r(s);
        return (
          (i.defaults = n.extend({}, s.defaults)),
          n.extend(i.defaults, e),
          (i.compatOptions = n.extend({}, s.compatOptions)),
          (i.namespace = t),
          (i.data = s.data),
          (i.Item = r(o)),
          n.htmlInit(i, t),
          u && u.bridget && u.bridget(t, i),
          i
        );
      }));
    var p = { ms: 1, s: 1e3 };
    return ((s.Item = o), s);
  }),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define("packery/js/rect", e)
      : "object" == typeof module && module.exports
        ? (module.exports = e())
        : ((t.Packery = t.Packery || {}), (t.Packery.Rect = e()));
  })(window, function () {
    "use strict";
    function t(e) {
      for (var i in t.defaults) this[i] = t.defaults[i];
      for (i in e) this[i] = e[i];
    }
    t.defaults = { x: 0, y: 0, width: 0, height: 0 };
    var e = t.prototype;
    return (
      (e.contains = function (t) {
        var e = t.width || 0,
          i = t.height || 0;
        return this.x <= t.x && this.y <= t.y && this.x + this.width >= t.x + e && this.y + this.height >= t.y + i;
      }),
      (e.overlaps = function (t) {
        var e = this.x + this.width,
          i = this.y + this.height,
          n = t.x + t.width,
          o = t.y + t.height;
        return this.x < n && e > t.x && this.y < o && i > t.y;
      }),
      (e.getMaximalFreeRects = function (e) {
        if (!this.overlaps(e)) return !1;
        var i,
          n = [],
          o = this.x + this.width,
          s = this.y + this.height,
          r = e.x + e.width,
          a = e.y + e.height;
        return (
          this.y < e.y && ((i = new t({ x: this.x, y: this.y, width: this.width, height: e.y - this.y })), n.push(i)),
          o > r && ((i = new t({ x: r, y: this.y, width: o - r, height: this.height })), n.push(i)),
          s > a && ((i = new t({ x: this.x, y: a, width: this.width, height: s - a })), n.push(i)),
          this.x < e.x && ((i = new t({ x: this.x, y: this.y, width: e.x - this.x, height: this.height })), n.push(i)),
          n
        );
      }),
      (e.canFit = function (t) {
        return this.width >= t.width && this.height >= t.height;
      }),
      t
    );
  }),
  (function (t, e) {
    if ("function" == typeof define && define.amd) define("packery/js/packer", ["./rect"], e);
    else if ("object" == typeof module && module.exports) module.exports = e(require("./rect"));
    else {
      var i = (t.Packery = t.Packery || {});
      i.Packer = e(i.Rect);
    }
  })(window, function (t) {
    "use strict";
    function e(t, e, i) {
      ((this.width = t || 0), (this.height = e || 0), (this.sortDirection = i || "downwardLeftToRight"), this.reset());
    }
    var i = e.prototype;
    ((i.reset = function () {
      this.spaces = [];
      var e = new t({ x: 0, y: 0, width: this.width, height: this.height });
      (this.spaces.push(e), (this.sorter = n[this.sortDirection] || n.downwardLeftToRight));
    }),
      (i.pack = function (t) {
        for (var e = 0; e < this.spaces.length; e++) {
          var i = this.spaces[e];
          if (i.canFit(t)) {
            this.placeInSpace(t, i);
            break;
          }
        }
      }),
      (i.columnPack = function (t) {
        for (var e = 0; e < this.spaces.length; e++) {
          var i = this.spaces[e],
            n = i.x <= t.x && i.x + i.width >= t.x + t.width && i.height >= t.height - 0.01;
          if (n) {
            ((t.y = i.y), this.placed(t));
            break;
          }
        }
      }),
      (i.rowPack = function (t) {
        for (var e = 0; e < this.spaces.length; e++) {
          var i = this.spaces[e],
            n = i.y <= t.y && i.y + i.height >= t.y + t.height && i.width >= t.width - 0.01;
          if (n) {
            ((t.x = i.x), this.placed(t));
            break;
          }
        }
      }),
      (i.placeInSpace = function (t, e) {
        ((t.x = e.x), (t.y = e.y), this.placed(t));
      }),
      (i.placed = function (t) {
        for (var e = [], i = 0; i < this.spaces.length; i++) {
          var n = this.spaces[i],
            o = n.getMaximalFreeRects(t);
          o ? e.push.apply(e, o) : e.push(n);
        }
        ((this.spaces = e), this.mergeSortSpaces());
      }),
      (i.mergeSortSpaces = function () {
        (e.mergeRects(this.spaces), this.spaces.sort(this.sorter));
      }),
      (i.addSpace = function (t) {
        (this.spaces.push(t), this.mergeSortSpaces());
      }),
      (e.mergeRects = function (t) {
        var e = 0,
          i = t[e];
        t: for (; i;) {
          for (var n = 0, o = t[e + n]; o;) {
            if (o == i) n++;
            else {
              if (o.contains(i)) {
                (t.splice(e, 1), (i = t[e]));
                continue t;
              }
              i.contains(o) ? t.splice(e + n, 1) : n++;
            }
            o = t[e + n];
          }
          (e++, (i = t[e]));
        }
        return t;
      }));
    var n = {
      downwardLeftToRight: function (t, e) {
        return t.y - e.y || t.x - e.x;
      },
      rightwardTopToBottom: function (t, e) {
        return t.x - e.x || t.y - e.y;
      },
    };
    return e;
  }),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define("packery/js/item", ["outlayer/outlayer", "./rect"], e)
      : "object" == typeof module && module.exports
        ? (module.exports = e(require("outlayer"), require("./rect")))
        : (t.Packery.Item = e(t.Outlayer, t.Packery.Rect));
  })(window, function (t, e) {
    "use strict";
    var i = document.documentElement.style,
      n = "string" == typeof i.transform ? "transform" : "WebkitTransform",
      o = function () {
        t.Item.apply(this, arguments);
      },
      s = (o.prototype = Object.create(t.Item.prototype)),
      r = s._create;
    s._create = function () {
      (r.call(this), (this.rect = new e()));
    };
    var a = s.moveTo;
    return (
      (s.moveTo = function (t, e) {
        var i = Math.abs(this.position.x - t),
          n = Math.abs(this.position.y - e),
          o = this.layout.dragItemCount && !this.isPlacing && !this.isTransitioning && 1 > i && 1 > n;
        return o ? void this.goTo(t, e) : void a.apply(this, arguments);
      }),
      (s.enablePlacing = function () {
        (this.removeTransitionStyles(),
          this.isTransitioning && n && (this.element.style[n] = "none"),
          (this.isTransitioning = !1),
          this.getSize(),
          this.layout._setRectSize(this.element, this.rect),
          (this.isPlacing = !0));
      }),
      (s.disablePlacing = function () {
        this.isPlacing = !1;
      }),
      (s.removeElem = function () {
        var t = this.element.parentNode;
        (t && t.removeChild(this.element), this.layout.packer.addSpace(this.rect), this.emitEvent("remove", [this]));
      }),
      (s.showDropPlaceholder = function () {
        var t = this.dropPlaceholder;
        (t ||
          ((t = this.dropPlaceholder = document.createElement("div")),
          (t.className = "packery-drop-placeholder"),
          (t.style.position = "absolute")),
          (t.style.width = this.size.width + "px"),
          (t.style.height = this.size.height + "px"),
          this.positionDropPlaceholder(),
          this.layout.element.appendChild(t));
      }),
      (s.positionDropPlaceholder = function () {
        this.dropPlaceholder.style[n] = "translate(" + this.rect.x + "px, " + this.rect.y + "px)";
      }),
      (s.hideDropPlaceholder = function () {
        var t = this.dropPlaceholder.parentNode;
        t && t.removeChild(this.dropPlaceholder);
      }),
      o
    );
  }),
  (function (t, e) {
    "function" == typeof define && define.amd
      ? define(["get-size/get-size", "outlayer/outlayer", "packery/js/rect", "packery/js/packer", "packery/js/item"], e)
      : "object" == typeof module && module.exports
        ? (module.exports = e(
            require("get-size"),
            require("outlayer"),
            require("./rect"),
            require("./packer"),
            require("./item"),
          ))
        : (t.Packery = e(t.getSize, t.Outlayer, t.Packery.Rect, t.Packery.Packer, t.Packery.Item));
  })(window, function (t, e, i, n, o) {
    "use strict";
    function s(t, e) {
      return t.position.y - e.position.y || t.position.x - e.position.x;
    }
    function r(t, e) {
      return t.position.x - e.position.x || t.position.y - e.position.y;
    }
    function a(t, e) {
      var i = e.x - t.x,
        n = e.y - t.y;
      return Math.sqrt(i * i + n * n);
    }
    i.prototype.canFit = function (t) {
      return this.width >= t.width - 1 && this.height >= t.height - 1;
    };
    var h = e.create("packery");
    h.Item = o;
    var u = h.prototype;
    ((u._create = function () {
      (e.prototype._create.call(this),
        (this.packer = new n()),
        (this.shiftPacker = new n()),
        (this.isEnabled = !0),
        (this.dragItemCount = 0));
      var t = this;
      ((this.handleDraggabilly = {
        dragStart: function () {
          t.itemDragStart(this.element);
        },
        dragMove: function () {
          t.itemDragMove(this.element, this.position.x, this.position.y);
        },
        dragEnd: function () {
          t.itemDragEnd(this.element);
        },
      }),
        (this.handleUIDraggable = {
          start: function (e, i) {
            i && t.itemDragStart(e.currentTarget);
          },
          drag: function (e, i) {
            i && t.itemDragMove(e.currentTarget, i.position.left, i.position.top);
          },
          stop: function (e, i) {
            i && t.itemDragEnd(e.currentTarget);
          },
        }));
    }),
      (u._resetLayout = function () {
        (this.getSize(), this._getMeasurements());
        var t, e, i;
        (this._getOption("horizontal")
          ? ((t = 1 / 0), (e = this.size.innerHeight + this.gutter), (i = "rightwardTopToBottom"))
          : ((t = this.size.innerWidth + this.gutter), (e = 1 / 0), (i = "downwardLeftToRight")),
          (this.packer.width = this.shiftPacker.width = t),
          (this.packer.height = this.shiftPacker.height = e),
          (this.packer.sortDirection = this.shiftPacker.sortDirection = i),
          this.packer.reset(),
          (this.maxY = 0),
          (this.maxX = 0));
      }),
      (u._getMeasurements = function () {
        (this._getMeasurement("columnWidth", "width"),
          this._getMeasurement("rowHeight", "height"),
          this._getMeasurement("gutter", "width"));
      }),
      (u._getItemLayoutPosition = function (t) {
        if ((this._setRectSize(t.element, t.rect), this.isShifting || this.dragItemCount > 0)) {
          var e = this._getPackMethod();
          this.packer[e](t.rect);
        } else this.packer.pack(t.rect);
        return (this._setMaxXY(t.rect), t.rect);
      }),
      (u.shiftLayout = function () {
        ((this.isShifting = !0), this.layout(), delete this.isShifting);
      }),
      (u._getPackMethod = function () {
        return this._getOption("horizontal") ? "rowPack" : "columnPack";
      }),
      (u._setMaxXY = function (t) {
        ((this.maxX = Math.max(t.x + t.width, this.maxX)), (this.maxY = Math.max(t.y + t.height, this.maxY)));
      }),
      (u._setRectSize = function (e, i) {
        var n = t(e),
          o = n.outerWidth,
          s = n.outerHeight;
        ((o || s) && ((o = this._applyGridGutter(o, this.columnWidth)), (s = this._applyGridGutter(s, this.rowHeight))),
          (i.width = Math.min(o, this.packer.width)),
          (i.height = Math.min(s, this.packer.height)));
      }),
      (u._applyGridGutter = function (t, e) {
        if (!e) return t + this.gutter;
        e += this.gutter;
        var i = t % e,
          n = i && 1 > i ? "round" : "ceil";
        return (t = Math[n](t / e) * e);
      }),
      (u._getContainerSize = function () {
        return this._getOption("horizontal") ? { width: this.maxX - this.gutter } : { height: this.maxY - this.gutter };
      }),
      (u._manageStamp = function (t) {
        var e,
          n = this.getItem(t);
        if (n && n.isPlacing) e = n.rect;
        else {
          var o = this._getElementOffset(t);
          e = new i({
            x: this._getOption("originLeft") ? o.left : o.right,
            y: this._getOption("originTop") ? o.top : o.bottom,
          });
        }
        (this._setRectSize(t, e), this.packer.placed(e), this._setMaxXY(e));
      }),
      (u.sortItemsByPosition = function () {
        var t = this._getOption("horizontal") ? r : s;
        this.items.sort(t);
      }),
      (u.fit = function (t, e, i) {
        var n = this.getItem(t);
        n &&
          (this.stamp(n.element),
          n.enablePlacing(),
          this.updateShiftTargets(n),
          (e = void 0 === e ? n.rect.x : e),
          (i = void 0 === i ? n.rect.y : i),
          this.shift(n, e, i),
          this._bindFitEvents(n),
          n.moveTo(n.rect.x, n.rect.y),
          this.shiftLayout(),
          this.unstamp(n.element),
          this.sortItemsByPosition(),
          n.disablePlacing());
      }),
      (u._bindFitEvents = function (t) {
        function e() {
          (n++, 2 == n && i.dispatchEvent("fitComplete", null, [t]));
        }
        var i = this,
          n = 0;
        (t.once("layout", e), this.once("layoutComplete", e));
      }),
      (u.resize = function () {
        this.isResizeBound &&
          this.needsResizeLayout() &&
          (this.options.shiftPercentResize ? this.resizeShiftPercentLayout() : this.layout());
      }),
      (u.needsResizeLayout = function () {
        var e = t(this.element),
          i = this._getOption("horizontal") ? "innerHeight" : "innerWidth";
        return e[i] != this.size[i];
      }),
      (u.resizeShiftPercentLayout = function () {
        var e = this._getItemsForLayout(this.items),
          i = this._getOption("horizontal"),
          n = i ? "y" : "x",
          o = i ? "height" : "width",
          s = i ? "rowHeight" : "columnWidth",
          r = i ? "innerHeight" : "innerWidth",
          a = this[s];
        if ((a = a && a + this.gutter)) {
          this._getMeasurements();
          var h = this[s] + this.gutter;
          e.forEach(function (t) {
            var e = Math.round(t.rect[n] / a);
            t.rect[n] = e * h;
          });
        } else {
          var u = t(this.element)[r] + this.gutter,
            c = this.packer[o];
          e.forEach(function (t) {
            t.rect[n] = (t.rect[n] / c) * u;
          });
        }
        this.shiftLayout();
      }),
      (u.itemDragStart = function (t) {
        if (this.isEnabled) {
          this.stamp(t);
          var e = this.getItem(t);
          e && (e.enablePlacing(), e.showDropPlaceholder(), this.dragItemCount++, this.updateShiftTargets(e));
        }
      }),
      (u.updateShiftTargets = function (t) {
        (this.shiftPacker.reset(), this._getBoundingRect());
        var e = this._getOption("originLeft"),
          n = this._getOption("originTop");
        this.stamps.forEach(function (t) {
          var o = this.getItem(t);
          if (!o || !o.isPlacing) {
            var s = this._getElementOffset(t),
              r = new i({ x: e ? s.left : s.right, y: n ? s.top : s.bottom });
            (this._setRectSize(t, r), this.shiftPacker.placed(r));
          }
        }, this);
        var o = this._getOption("horizontal"),
          s = o ? "rowHeight" : "columnWidth",
          r = o ? "height" : "width";
        ((this.shiftTargetKeys = []), (this.shiftTargets = []));
        var a,
          h = this[s];
        if ((h = h && h + this.gutter)) {
          var u = Math.ceil(t.rect[r] / h),
            c = Math.floor((this.shiftPacker[r] + this.gutter) / h);
          a = (c - u) * h;
          for (var d = 0; c > d; d++) {
            var l = o ? 0 : d * h,
              f = o ? d * h : 0;
            this._addShiftTarget(l, f, a);
          }
        } else ((a = this.shiftPacker[r] + this.gutter - t.rect[r]), this._addShiftTarget(0, 0, a));
        var p = this._getItemsForLayout(this.items),
          g = this._getPackMethod();
        p.forEach(function (t) {
          var e = t.rect;
          (this._setRectSize(t.element, e), this.shiftPacker[g](e), this._addShiftTarget(e.x, e.y, a));
          var i = o ? e.x + e.width : e.x,
            n = o ? e.y : e.y + e.height;
          if ((this._addShiftTarget(i, n, a), h))
            for (var s = Math.round(e[r] / h), u = 1; s > u; u++) {
              var c = o ? i : e.x + h * u,
                d = o ? e.y + h * u : n;
              this._addShiftTarget(c, d, a);
            }
        }, this);
      }),
      (u._addShiftTarget = function (t, e, i) {
        var n = this._getOption("horizontal") ? e : t;
        if (!(0 !== n && n > i)) {
          var o = t + "," + e,
            s = -1 != this.shiftTargetKeys.indexOf(o);
          s || (this.shiftTargetKeys.push(o), this.shiftTargets.push({ x: t, y: e }));
        }
      }),
      (u.shift = function (t, e, i) {
        var n,
          o = 1 / 0,
          s = { x: e, y: i };
        (this.shiftTargets.forEach(function (t) {
          var e = a(t, s);
          o > e && ((n = t), (o = e));
        }),
          (t.rect.x = n.x),
          (t.rect.y = n.y));
      }));
    var c = 120;
    ((u.itemDragMove = function (t, e, i) {
      function n() {
        (s.shift(o, e, i), o.positionDropPlaceholder(), s.layout());
      }
      var o = this.isEnabled && this.getItem(t);
      if (o) {
        ((e -= this.size.paddingLeft), (i -= this.size.paddingTop));
        var s = this,
          r = new Date(),
          a = this._itemDragTime && r - this._itemDragTime < c;
        a ? (clearTimeout(this.dragTimeout), (this.dragTimeout = setTimeout(n, c))) : (n(), (this._itemDragTime = r));
      }
    }),
      (u.itemDragEnd = function (t) {
        function e() {
          (n++,
            2 == n &&
              (i.element.classList.remove("is-positioning-post-drag"),
              i.hideDropPlaceholder(),
              o.dispatchEvent("dragItemPositioned", null, [i])));
        }
        var i = this.isEnabled && this.getItem(t);
        if (i) {
          (clearTimeout(this.dragTimeout), i.element.classList.add("is-positioning-post-drag"));
          var n = 0,
            o = this;
          (i.once("layout", e),
            this.once("layoutComplete", e),
            i.moveTo(i.rect.x, i.rect.y),
            this.layout(),
            (this.dragItemCount = Math.max(0, this.dragItemCount - 1)),
            this.sortItemsByPosition(),
            i.disablePlacing(),
            this.unstamp(i.element));
        }
      }),
      (u.bindDraggabillyEvents = function (t) {
        this._bindDraggabillyEvents(t, "on");
      }),
      (u.unbindDraggabillyEvents = function (t) {
        this._bindDraggabillyEvents(t, "off");
      }),
      (u._bindDraggabillyEvents = function (t, e) {
        var i = this.handleDraggabilly;
        (t[e]("dragStart", i.dragStart), t[e]("dragMove", i.dragMove), t[e]("dragEnd", i.dragEnd));
      }),
      (u.bindUIDraggableEvents = function (t) {
        this._bindUIDraggableEvents(t, "on");
      }),
      (u.unbindUIDraggableEvents = function (t) {
        this._bindUIDraggableEvents(t, "off");
      }),
      (u._bindUIDraggableEvents = function (t, e) {
        var i = this.handleUIDraggable;
        t[e]("dragstart", i.start)[e]("drag", i.drag)[e]("dragstop", i.stop);
      }));
    var d = u.destroy;
    return (
      (u.destroy = function () {
        (d.apply(this, arguments), (this.isEnabled = !1));
      }),
      (h.Rect = i),
      (h.Packer = n),
      h
    );
  }));
!(function (e, t) {
  "object" == typeof exports && "undefined" != typeof module
    ? t(exports)
    : "function" == typeof define && define.amd
      ? define(["exports"], t)
      : t(((e = e || self).timeago = {}));
})(this, function (e) {
  "use strict";
  var r = ["second", "minute", "hour", "day", "week", "month", "year"];
  var a = ["秒", "分钟", "小时", "天", "周", "个月", "年"];
  function t(e, t) {
    n[e] = t;
  }
  function i(e) {
    return n[e] || n.en_US;
  }
  var n = {},
    f = [60, 60, 24, 7, 365 / 7 / 12, 12];
  function o(e) {
    return e instanceof Date
      ? e
      : !isNaN(e) || /^\d+$/.test(e)
        ? new Date(parseInt(e))
        : ((e = (e || "")
            .trim()
            .replace(/\.\d+/, "")
            .replace(/-/, "/")
            .replace(/-/, "/")
            .replace(/(\d)T(\d)/, "$1 $2")
            .replace(/Z/, " UTC")
            .replace(/([+-]\d\d):?(\d\d)/, " $1$2")),
          new Date(e));
  }
  function d(e, t) {
    for (var n = e < 0 ? 1 : 0, r = (e = Math.abs(e)), a = 0; e >= f[a] && a < f.length; a++) e /= f[a];
    return ((0 === (a *= 2) ? 9 : 1) < (e = Math.floor(e)) && (a += 1), t(e, a, r)[n].replace("%s", e.toString()));
  }
  function l(e, t) {
    return ((t ? o(t) : new Date()) - o(e)) / 1e3;
  }
  var s = "timeago-id";
  function h(e) {
    return parseInt(e.getAttribute(s));
  }
  var p = {},
    v = function (e) {
      (clearTimeout(e), delete p[e]);
    };
  function m(e, t, n, r) {
    v(h(e));
    var a = r.relativeDate,
      i = r.minInterval,
      o = l(t, a);
    e.innerText = d(o, n);
    var u,
      c = setTimeout(
        function () {
          m(e, t, n, r);
        },
        Math.min(
          1e3 *
            Math.max(
              (function (e) {
                for (var t = 1, n = 0, r = Math.abs(e); e >= f[n] && n < f.length; n++) ((e /= f[n]), (t *= f[n]));
                return ((r = (r %= t) ? t - r : t), Math.ceil(r));
              })(o),
              i || 1,
            ),
          2147483647,
        ),
      );
    ((p[c] = 0), (u = c), e.setAttribute(s, u));
  }
  (t("en_US", function (e, t) {
    if (0 === t) return ["just now", "right now"];
    var n = r[Math.floor(t / 2)];
    return (1 < e && (n += "s"), [e + " " + n + " ago", "in " + e + " " + n]);
  }),
    t("zh_CN", function (e, t) {
      if (0 === t) return ["刚刚", "片刻后"];
      var n = a[~~(t / 2)];
      return [e + " " + n + "前", e + " " + n + "后"];
    }),
    (e.cancel = function (e) {
      e ? v(h(e)) : Object.keys(p).forEach(v);
    }),
    (e.format = function (e, t, n) {
      return d(l(e, n && n.relativeDate), i(t));
    }),
    (e.register = t),
    (e.render = function (e, t, n) {
      var r = e.length ? e : [e];
      return (
        r.forEach(function (e) {
          m(e, e.getAttribute("datetime"), i(t), n || {});
        }),
        r
      );
    }),
    Object.defineProperty(e, "__esModule", { value: !0 }));
});
!(function (t, e) {
  "object" == typeof exports && "undefined" != typeof module
    ? (module.exports = e)
    : "function" == typeof define && define.amd
      ? define([], function () {
          return e(t);
        })
      : (t.Qmsg = e(t));
})(this, function (t) {
  ("function" != typeof Object.assign &&
    (Object.assign = function (t) {
      if (null == t) throw new TypeError("Cannot convert undefined or null to object");
      t = Object(t);
      for (var e = 1; e < arguments.length; e++) {
        var n = arguments[e];
        if (null != n) for (var i in n) Object.prototype.hasOwnProperty.call(n, i) && (t[i] = n[i]);
      }
      return t;
    }),
    "classList" in HTMLElement.prototype ||
      Object.defineProperty(HTMLElement.prototype, "classList", {
        get: function () {
          var e = this;
          return {
            add: function (t) {
              this.contains(t) || (e.className += " " + t);
            },
            remove: function (t) {
              this.contains(t) && ((t = new RegExp(t)), (e.className = e.className.replace(t, "")));
            },
            contains: function (t) {
              return -1 != e.className.indexOf(t);
            },
            toggle: function (t) {
              this.contains(t) ? this.remove(t) : this.add(t);
            },
          };
        },
      }));
  var l = (t && t.QMSG_GLOBALS && t.QMSG_GLOBALS.NAMESPACE) || "qmsg",
    a = { opening: "MessageMoveIn", done: "", closing: "MessageMoveOut" },
    m = Object.assign(
      {
        position: "center",
        type: "info",
        showClose: !1,
        timeout: 2500,
        animation: !0,
        autoClose: !0,
        content: "",
        onClose: null,
        maxNums: 5,
        html: !1,
      },
      t && t.QMSG_GLOBALS && t.QMSG_GLOBALS.DEFAULTS,
    ),
    c = {
      info: '<svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" fill="white" fill-opacity="0.01"/><path d="M24 44C29.5228 44 34.5228 41.7614 38.1421 38.1421C41.7614 34.5228 44 29.5228 44 24C44 18.4772 41.7614 13.4772 38.1421 9.85786C34.5228 6.23858 29.5228 4 24 4C18.4772 4 13.4772 6.23858 9.85786 9.85786C6.23858 13.4772 4 18.4772 4 24C4 29.5228 6.23858 34.5228 9.85786 38.1421C13.4772 41.7614 18.4772 44 24 44Z" fill="#1890ff" stroke="#1890ff" stroke-width="4" stroke-linejoin="round"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 11C25.3807 11 26.5 12.1193 26.5 13.5C26.5 14.8807 25.3807 16 24 16C22.6193 16 21.5 14.8807 21.5 13.5C21.5 12.1193 22.6193 11 24 11Z" fill="#FFF"/><path d="M24.5 34V20H23.5H22.5" stroke="#FFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 34H28" stroke="#FFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      warning:
        '<svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" fill="white" fill-opacity="0.01"/><path d="M24 44C29.5228 44 34.5228 41.7614 38.1421 38.1421C41.7614 34.5228 44 29.5228 44 24C44 18.4772 41.7614 13.4772 38.1421 9.85786C34.5228 6.23858 29.5228 4 24 4C18.4772 4 13.4772 6.23858 9.85786 9.85786C6.23858 13.4772 4 18.4772 4 24C4 29.5228 6.23858 34.5228 9.85786 38.1421C13.4772 41.7614 18.4772 44 24 44Z" fill="#faad14" stroke="#faad14" stroke-width="4" stroke-linejoin="round"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 37C25.3807 37 26.5 35.8807 26.5 34.5C26.5 33.1193 25.3807 32 24 32C22.6193 32 21.5 33.1193 21.5 34.5C21.5 35.8807 22.6193 37 24 37Z" fill="#FFF"/><path d="M24 12V28" stroke="#FFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      error:
        '<svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" fill="white" fill-opacity="0.01"/><path d="M24 44C35.0457 44 44 35.0457 44 24C44 12.9543 35.0457 4 24 4C12.9543 4 4 12.9543 4 24C4 35.0457 12.9543 44 24 44Z" fill="#f5222d" stroke="#f5222d" stroke-width="4" stroke-linejoin="round"/><path d="M29.6569 18.3431L18.3432 29.6568" stroke="#FFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.3432 18.3431L29.6569 29.6568" stroke="#FFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      success:
        '<svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" fill="white" fill-opacity="0.01"/><path d="M24 4L29.2533 7.83204L35.7557 7.81966L37.7533 14.0077L43.0211 17.8197L41 24L43.0211 30.1803L37.7533 33.9923L35.7557 40.1803L29.2533 40.168L24 44L18.7467 40.168L12.2443 40.1803L10.2467 33.9923L4.97887 30.1803L7 24L4.97887 17.8197L10.2467 14.0077L12.2443 7.81966L18.7467 7.83204L24 4Z" fill="#52c41a" stroke="#52c41a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 24L22 29L32 19" stroke="#FFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      loading:
        '<svg class="animate-turn" width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" fill="white" fill-opacity="0.01"/><path d="M4 24C4 35.0457 12.9543 44 24 44V44C35.0457 44 44 35.0457 44 24C44 12.9543 35.0457 4 24 4" stroke="#1890ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M36 24C36 17.3726 30.6274 12 24 12C17.3726 12 12 17.3726 12 24C12 30.6274 17.3726 36 24 36V36" stroke="#1890ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      close:
        '<svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" fill="white" fill-opacity="0.01"/><path d="M14 14L34 34" stroke="#909399" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 34L34 14" stroke="#909399" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    },
    e =
      void 0 !== (t = document.createElement("div").style).animationName ||
      void 0 !== t.WebkitAnimationName ||
      void 0 !== t.MozAnimationName ||
      void 0 !== t.msAnimationName ||
      void 0 !== t.OAnimationName;
  function g() {
    for (var t = l, e = 0; e < arguments.length; ++e) t += "-" + arguments[e];
    return t;
  }
  function f(t) {
    var e = this;
    ((e.settings = Object.assign({}, m, t || {})), (e.id = h.instanceCount));
    var n =
      (n = e.settings.timeout) && parseInt(0 <= n) & (parseInt(n) <= Math.NEGATIVE_INFINITY) ? parseInt(n) : m.timeout;
    ((e.timeout = n), (e.settings.timeout = n), (e.timer = null));
    var i = document.createElement("div"),
      o = c[e.settings.type || "info"],
      s = g("content-" + e.settings.type || "info");
    s += e.settings.showClose ? " " + g("content-with-close") : "";
    var r = e.settings.content || "",
      t = c.close,
      n = e.settings.showClose ? '<i class="qmsg-icon qmsg-icon-close">' + t + "</i>" : "",
      t = document.createElement("span");
    (e.settings.html ? (t.innerHTML = r) : (t.innerText = r),
      (i.innerHTML =
        '<div class="qmsg-content">            <div class="' +
        s +
        '">                <i class="qmsg-icon">' +
        o +
        "</i>" +
        t.outerHTML +
        n +
        "</div>        </div>"),
      i.classList.add(g("item")),
      (i.style.textAlign = e.settings.position));
    n = document.querySelector("." + l);
    (n ||
      ((n = document.createElement("div")).classList.add(l, g("wrapper"), g("is-initialized")),
      document.body.appendChild(n)),
      n.appendChild(i),
      (e.$wrapper = n),
      (e.$elem = i),
      d(e, "opening"),
      e.settings.showClose &&
        i.querySelector(".qmsg-icon-close").addEventListener(
          "click",
          function () {
            e.close();
          }.bind(i),
        ),
      i.addEventListener(
        "animationend",
        function (t) {
          var e = t.target;
          (t.animationName == a.closing && (clearInterval(this.timer), this.destroy()),
            (e.style.animationName = ""),
            (e.style.webkitAnimationName = ""));
        }.bind(e),
      ),
      e.settings.autoClose &&
        ((e.timer = setInterval(
          function () {
            ((this.timeout -= 10), this.timeout <= 0 && (clearInterval(this.timer), this.close()));
          }.bind(e),
          10,
        )),
        e.$elem.addEventListener(
          "mouseover",
          function () {
            clearInterval(this.timer);
          }.bind(e),
        ),
        e.$elem.addEventListener(
          "mouseout",
          function () {
            "closing" != this.state &&
              (this.timer = setInterval(
                function () {
                  ((this.timeout -= 10), this.timeout <= 0 && (clearInterval(this.timer), this.close()));
                }.bind(e),
                10,
              ));
          }.bind(e),
        )));
  }
  function d(t, e) {
    e && a[e] && ((t.state = e), (t.$elem.style.animationName = a[e]));
  }
  function n(t, e) {
    var n = Object.assign({}, m);
    return 0 === arguments.length
      ? n
      : t instanceof Object
        ? Object.assign(n, t)
        : ((n.content = t.toString()), e instanceof Object ? Object.assign(n, e) : n);
  }
  function i(t) {
    t = t || {};
    var e,
      n,
      i,
      o,
      s = JSON.stringify(t),
      r = -1;
    for (n in this.oMsgs) {
      var l = this.oMsgs[n];
      if (l.config == s) {
        ((r = n), (e = l.inst));
        break;
      }
    }
    if (r < 0) {
      this.instanceCount++;
      var a = {};
      ((a.id = this.instanceCount),
        (a.config = s),
        ((e = new f(t)).id = this.instanceCount),
        (e.count = ""),
        (a.inst = e),
        (this.oMsgs[this.instanceCount] = a));
      var c = this.oMsgs.length,
        d = this.maxNums;
      if (d < c)
        for (var h = 0, u = this.oMsgs; h < c - d; h++) u[h] && u[h].inst.settings.autoClose && u[h].inst.close();
    } else
      ((e.count = e.count ? (99 <= e.count ? e.count : e.count + 1) : 2),
        (i = e),
        (o = g("count")),
        (t = i.$elem.querySelector("." + g("content"))),
        (a = t.querySelector("." + o)) || ((a = document.createElement("span")).classList.add(o), t.appendChild(a)),
        (a.innerHTML = i.count),
        (a.style.animationName = ""),
        (a.style.animationName = "MessageShake"),
        (i.timeout = i.settings.timeout || m.timeout));
    return (e.$elem.setAttribute("data-count", e.count), e);
  }
  ((f.prototype.destroy = function () {
    (this.$elem.parentNode && this.$elem.parentNode.removeChild(this.$elem),
      clearInterval(this.timer),
      h.remove(this.id));
  }),
    (f.prototype.close = function () {
      (d(this, "closing"), e ? h.remove(this.id) : this.destroy());
      var t = this.settings.onClose;
      t && t instanceof Function && t.call(this);
    }));
  var h = {
    version: "0.0.1",
    instanceCount: 0,
    oMsgs: [],
    maxNums: m.maxNums || 5,
    config: function (t) {
      ((m = t && t instanceof Object ? Object.assign(m, t) : m),
        (this.maxNums = m.maxNums && 0 < m.maxNums ? parseInt(m.maxNums) : 3));
    },
    info: function (t, e) {
      e = n(t, e);
      return ((e.type = "info"), i.call(this, e));
    },
    warning: function (t, e) {
      e = n(t, e);
      return ((e.type = "warning"), i.call(this, e));
    },
    success: function (t, e) {
      e = n(t, e);
      return ((e.type = "success"), i.call(this, e));
    },
    error: function (t, e) {
      e = n(t, e);
      return ((e.type = "error"), i.call(this, e));
    },
    loading: function (t, e) {
      e = n(t, e);
      return ((e.type = "loading"), (e.autoClose = !1), i.call(this, e));
    },
    remove: function (t) {
      this.oMsgs[t] && delete this.oMsgs[t];
    },
    closeAll: function () {
      for (var t in this.oMsgs) this.oMsgs[t] && this.oMsgs[t].inst.close();
    },
  };
  return h;
});
!(function (t, e) {
  "object" == typeof exports && "undefined" != typeof module
    ? (module.exports = e())
    : "function" == typeof define && define.amd
      ? define(e)
      : ((t = t || self).Zooming = e());
})(this, function () {
  "use strict";
  var t = "auto",
    e = "zoom-in",
    i = "zoom-out",
    n = "grab",
    s = "move";
  function o(t, e, i) {
    var n = { passive: !1 };
    !(arguments.length > 3 && void 0 !== arguments[3]) || arguments[3]
      ? t.addEventListener(e, i, n)
      : t.removeEventListener(e, i, n);
  }
  function r(t, e) {
    if (t) {
      var i = new Image();
      ((i.onload = function () {
        e && e(i);
      }),
        (i.src = t));
    }
  }
  function a(t) {
    return t.dataset.original
      ? t.dataset.original
      : "A" === t.parentNode.tagName
        ? t.parentNode.getAttribute("href")
        : null;
  }
  function l(t, e, i) {
    !(function (t) {
      var e = h.transitionProp,
        i = h.transformProp;
      if (t.transition) {
        var n = t.transition;
        (delete t.transition, (t[e] = n));
      }
      if (t.transform) {
        var s = t.transform;
        (delete t.transform, (t[i] = s));
      }
    })(e);
    var n = t.style,
      s = {};
    for (var o in e) (i && (s[o] = n[o] || ""), (n[o] = e[o]));
    return s;
  }
  var h = {
      transitionProp: "transition",
      transEndEvent: "transitionend",
      transformProp: "transform",
      transformCssProp: "transform",
    },
    c = h.transformCssProp,
    u = h.transEndEvent;
  var d = function () {},
    f = {
      enableGrab: !0,
      preloadImage: !1,
      closeOnWindowResize: !0,
      transitionDuration: 0.4,
      transitionTimingFunction: "cubic-bezier(0.4, 0, 0, 1)",
      bgColor: "rgb(255, 255, 255)",
      bgOpacity: 1,
      scaleBase: 1,
      scaleExtra: 0.5,
      scrollThreshold: 40,
      zIndex: 998,
      customSize: null,
      onOpen: d,
      onClose: d,
      onGrab: d,
      onMove: d,
      onRelease: d,
      onBeforeOpen: d,
      onBeforeClose: d,
      onBeforeGrab: d,
      onBeforeRelease: d,
      onImageLoading: d,
      onImageLoaded: d,
    },
    p = {
      init: function (t) {
        var e, i;
        ((e = this),
          (i = t),
          Object.getOwnPropertyNames(Object.getPrototypeOf(e)).forEach(function (t) {
            e[t] = e[t].bind(i);
          }));
      },
      click: function (t) {
        if ((t.preventDefault(), m(t))) return window.open(this.target.srcOriginal || t.currentTarget.src, "_blank");
        this.shown ? (this.released ? this.close() : this.release()) : this.open(t.currentTarget);
      },
      scroll: function () {
        var t = document.documentElement || document.body.parentNode || document.body,
          e = window.pageXOffset || t.scrollLeft,
          i = window.pageYOffset || t.scrollTop;
        null === this.lastScrollPosition && (this.lastScrollPosition = { x: e, y: i });
        var n = this.lastScrollPosition.x - e,
          s = this.lastScrollPosition.y - i,
          o = this.options.scrollThreshold;
        (Math.abs(s) >= o || Math.abs(n) >= o) && ((this.lastScrollPosition = null), this.close());
      },
      keydown: function (t) {
        (function (t) {
          return "Escape" === (t.key || t.code) || 27 === t.keyCode;
        })(t) && (this.released ? this.close() : this.release(this.close));
      },
      mousedown: function (t) {
        if (y(t) && !m(t)) {
          t.preventDefault();
          var e = t.clientX,
            i = t.clientY;
          this.pressTimer = setTimeout(
            function () {
              this.grab(e, i);
            }.bind(this),
            200,
          );
        }
      },
      mousemove: function (t) {
        this.released || this.move(t.clientX, t.clientY);
      },
      mouseup: function (t) {
        y(t) && !m(t) && (clearTimeout(this.pressTimer), this.released ? this.close() : this.release());
      },
      touchstart: function (t) {
        t.preventDefault();
        var e = t.touches[0],
          i = e.clientX,
          n = e.clientY;
        this.pressTimer = setTimeout(
          function () {
            this.grab(i, n);
          }.bind(this),
          200,
        );
      },
      touchmove: function (t) {
        if (!this.released) {
          var e = t.touches[0],
            i = e.clientX,
            n = e.clientY;
          this.move(i, n);
        }
      },
      touchend: function (t) {
        (function (t) {
          t.targetTouches.length;
        })(t) || (clearTimeout(this.pressTimer), this.released ? this.close() : this.release());
      },
      clickOverlay: function () {
        this.close();
      },
      resizeWindow: function () {
        this.close();
      },
    };
  function y(t) {
    return 0 === t.button;
  }
  function m(t) {
    return t.metaKey || t.ctrlKey;
  }
  var g = {
      init: function (t) {
        ((this.el = document.createElement("div")),
          (this.instance = t),
          (this.parent = document.body),
          l(this.el, { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, opacity: 0 }),
          this.updateStyle(t.options),
          o(this.el, "click", t.handler.clickOverlay.bind(t)));
      },
      updateStyle: function (t) {
        l(this.el, {
          zIndex: t.zIndex,
          backgroundColor: t.bgColor,
          transition: "opacity\n        " + t.transitionDuration + "s\n        " + t.transitionTimingFunction,
        });
      },
      insert: function () {
        this.parent.appendChild(this.el);
      },
      remove: function () {
        this.parent.removeChild(this.el);
      },
      fadeIn: function () {
        (this.el.offsetWidth, (this.el.style.opacity = this.instance.options.bgOpacity));
      },
      fadeOut: function () {
        this.el.style.opacity = 0;
      },
    },
    v =
      "function" == typeof Symbol && "symbol" == typeof Symbol.iterator
        ? function (t) {
            return typeof t;
          }
        : function (t) {
            return t && "function" == typeof Symbol && t.constructor === Symbol && t !== Symbol.prototype
              ? "symbol"
              : typeof t;
          },
    b = function (t, e) {
      if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function");
    },
    w = (function () {
      function t(t, e) {
        for (var i = 0; i < e.length; i++) {
          var n = e[i];
          ((n.enumerable = n.enumerable || !1),
            (n.configurable = !0),
            "value" in n && (n.writable = !0),
            Object.defineProperty(t, n.key, n));
        }
      }
      return function (e, i, n) {
        return (i && t(e.prototype, i), n && t(e, n), e);
      };
    })(),
    x =
      Object.assign ||
      function (t) {
        for (var e = 1; e < arguments.length; e++) {
          var i = arguments[e];
          for (var n in i) Object.prototype.hasOwnProperty.call(i, n) && (t[n] = i[n]);
        }
        return t;
      },
    O = {
      init: function (t, e) {
        ((this.el = t),
          (this.instance = e),
          (this.srcThumbnail = this.el.getAttribute("src")),
          (this.srcset = this.el.getAttribute("srcset")),
          (this.srcOriginal = a(this.el)),
          (this.rect = this.el.getBoundingClientRect()),
          (this.translate = null),
          (this.scale = null),
          (this.styleOpen = null),
          (this.styleClose = null));
      },
      zoomIn: function () {
        var t = this.instance.options,
          e = t.zIndex,
          s = t.enableGrab,
          o = t.transitionDuration,
          r = t.transitionTimingFunction;
        ((this.translate = this.calculateTranslate()),
          (this.scale = this.calculateScale()),
          (this.styleOpen = {
            position: "relative",
            zIndex: e + 1,
            cursor: s ? n : i,
            transition: c + "\n        " + o + "s\n        " + r,
            transform:
              "translate3d(" +
              this.translate.x +
              "px, " +
              this.translate.y +
              "px, 0px)\n        scale(" +
              this.scale.x +
              "," +
              this.scale.y +
              ")",
            height: this.rect.height + "px",
            width: this.rect.width + "px",
          }),
          this.el.offsetWidth,
          (this.styleClose = l(this.el, this.styleOpen, !0)));
      },
      zoomOut: function () {
        (this.el.offsetWidth, l(this.el, { transform: "none" }));
      },
      grab: function (t, e, i) {
        var n = k(),
          o = n.x - t,
          r = n.y - e;
        l(this.el, {
          cursor: s,
          transform:
            "translate3d(\n        " +
            (this.translate.x + o) +
            "px, " +
            (this.translate.y + r) +
            "px, 0px)\n        scale(" +
            (this.scale.x + i) +
            "," +
            (this.scale.y + i) +
            ")",
        });
      },
      move: function (t, e, i) {
        var n = k(),
          s = n.x - t,
          o = n.y - e;
        l(this.el, {
          transition: c,
          transform:
            "translate3d(\n        " +
            (this.translate.x + s) +
            "px, " +
            (this.translate.y + o) +
            "px, 0px)\n        scale(" +
            (this.scale.x + i) +
            "," +
            (this.scale.y + i) +
            ")",
        });
      },
      restoreCloseStyle: function () {
        l(this.el, this.styleClose);
      },
      restoreOpenStyle: function () {
        l(this.el, this.styleOpen);
      },
      upgradeSource: function () {
        if (this.srcOriginal) {
          var t = this.el.parentNode;
          this.srcset && this.el.removeAttribute("srcset");
          var e = this.el.cloneNode(!1);
          (e.setAttribute("src", this.srcOriginal),
            (e.style.position = "fixed"),
            (e.style.visibility = "hidden"),
            t.appendChild(e),
            setTimeout(
              function () {
                (this.el.setAttribute("src", this.srcOriginal), t.removeChild(e));
              }.bind(this),
              50,
            ));
        }
      },
      downgradeSource: function () {
        this.srcOriginal &&
          (this.srcset && this.el.setAttribute("srcset", this.srcset), this.el.setAttribute("src", this.srcThumbnail));
      },
      calculateTranslate: function () {
        var t = k(),
          e = this.rect.left + this.rect.width / 2,
          i = this.rect.top + this.rect.height / 2;
        return { x: t.x - e, y: t.y - i };
      },
      calculateScale: function () {
        var t = this.el.dataset,
          e = t.zoomingHeight,
          i = t.zoomingWidth,
          n = this.instance.options,
          s = n.customSize,
          o = n.scaleBase;
        if (!s && e && i) return { x: i / this.rect.width, y: e / this.rect.height };
        if (s && "object" === (void 0 === s ? "undefined" : v(s)))
          return { x: s.width / this.rect.width, y: s.height / this.rect.height };
        var r = this.rect.width / 2,
          a = this.rect.height / 2,
          l = k(),
          h = { x: l.x - r, y: l.y - a },
          c = h.x / r,
          u = h.y / a,
          d = o + Math.min(c, u);
        if (s && "string" == typeof s) {
          var f = i || this.el.naturalWidth,
            p = e || this.el.naturalHeight,
            y = (parseFloat(s) * f) / (100 * this.rect.width),
            m = (parseFloat(s) * p) / (100 * this.rect.height);
          if (d > y || d > m) return { x: y, y: m };
        }
        return { x: d, y: d };
      },
    };
  function k() {
    var t = document.documentElement;
    return { x: Math.min(t.clientWidth, window.innerWidth) / 2, y: Math.min(t.clientHeight, window.innerHeight) / 2 };
  }
  function S(t, e, i) {
    ["mousedown", "mousemove", "mouseup", "touchstart", "touchmove", "touchend"].forEach(function (n) {
      o(t, n, e[n], i);
    });
  }
  return (function () {
    function i(t) {
      (b(this, i),
        (this.target = Object.create(O)),
        (this.overlay = Object.create(g)),
        (this.handler = Object.create(p)),
        (this.body = document.body),
        (this.shown = !1),
        (this.lock = !1),
        (this.released = !0),
        (this.lastScrollPosition = null),
        (this.pressTimer = null),
        (this.options = x({}, f, t)),
        this.overlay.init(this),
        this.handler.init(this));
    }
    return (
      w(i, [
        {
          key: "listen",
          value: function (t) {
            if ("string" == typeof t) for (var i = document.querySelectorAll(t), n = i.length; n--;) this.listen(i[n]);
            else
              "IMG" === t.tagName &&
                ((t.style.cursor = e), o(t, "click", this.handler.click), this.options.preloadImage && r(a(t)));
            return this;
          },
        },
        {
          key: "config",
          value: function (t) {
            return t ? (x(this.options, t), this.overlay.updateStyle(this.options), this) : this.options;
          },
        },
        {
          key: "open",
          value: function (t) {
            var e = this,
              i = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this.options.onOpen;
            if (!this.shown && !this.lock) {
              var n = "string" == typeof t ? document.querySelector(t) : t;
              if ("IMG" === n.tagName) {
                if ((this.options.onBeforeOpen(n), this.target.init(n, this), !this.options.preloadImage)) {
                  var s = this.target.srcOriginal;
                  null != s && (this.options.onImageLoading(n), r(s, this.options.onImageLoaded));
                }
                ((this.shown = !0),
                  (this.lock = !0),
                  this.target.zoomIn(),
                  this.overlay.insert(),
                  this.overlay.fadeIn(),
                  o(document, "scroll", this.handler.scroll),
                  o(document, "keydown", this.handler.keydown),
                  this.options.closeOnWindowResize && o(window, "resize", this.handler.resizeWindow));
                return (
                  o(n, u, function t() {
                    (o(n, u, t, !1),
                      (e.lock = !1),
                      e.target.upgradeSource(),
                      e.options.enableGrab && S(document, e.handler, !0),
                      i(n));
                  }),
                  this
                );
              }
            }
          },
        },
        {
          key: "close",
          value: function () {
            var e = this,
              i = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this.options.onClose;
            if (this.shown && !this.lock) {
              var n = this.target.el;
              (this.options.onBeforeClose(n),
                (this.lock = !0),
                (this.body.style.cursor = t),
                this.overlay.fadeOut(),
                this.target.zoomOut(),
                o(document, "scroll", this.handler.scroll, !1),
                o(document, "keydown", this.handler.keydown, !1),
                this.options.closeOnWindowResize && o(window, "resize", this.handler.resizeWindow, !1));
              return (
                o(n, u, function t() {
                  (o(n, u, t, !1),
                    (e.shown = !1),
                    (e.lock = !1),
                    e.target.downgradeSource(),
                    e.options.enableGrab && S(document, e.handler, !1),
                    e.target.restoreCloseStyle(),
                    e.overlay.remove(),
                    i(n));
                }),
                this
              );
            }
          },
        },
        {
          key: "grab",
          value: function (t, e) {
            var i = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : this.options.scaleExtra,
              n = arguments.length > 3 && void 0 !== arguments[3] ? arguments[3] : this.options.onGrab;
            if (this.shown && !this.lock) {
              var s = this.target.el;
              (this.options.onBeforeGrab(s), (this.released = !1), this.target.grab(t, e, i));
              return (
                o(s, u, function t() {
                  (o(s, u, t, !1), n(s));
                }),
                this
              );
            }
          },
        },
        {
          key: "move",
          value: function (t, e) {
            var i = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : this.options.scaleExtra,
              n = arguments.length > 3 && void 0 !== arguments[3] ? arguments[3] : this.options.onMove;
            if (this.shown && !this.lock) {
              ((this.released = !1), (this.body.style.cursor = s), this.target.move(t, e, i));
              var r = this.target.el;
              return (
                o(r, u, function t() {
                  (o(r, u, t, !1), n(r));
                }),
                this
              );
            }
          },
        },
        {
          key: "release",
          value: function () {
            var e = this,
              i = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this.options.onRelease;
            if (this.shown && !this.lock) {
              var n = this.target.el;
              (this.options.onBeforeRelease(n),
                (this.lock = !0),
                (this.body.style.cursor = t),
                this.target.restoreOpenStyle());
              return (
                o(n, u, function t() {
                  (o(n, u, t, !1), (e.lock = !1), (e.released = !0), i(n));
                }),
                this
              );
            }
          },
        },
      ]),
      i
    );
  })();
});
/*!
	autosize 4.0.2
	license: MIT
	http://www.jacklmoore.com/autosize
*/
!(function (e, t) {
  if ("function" == typeof define && define.amd) define(["module", "exports"], t);
  else if ("undefined" != typeof exports) t(module, exports);
  else {
    var n = { exports: {} };
    (t(n, n.exports), (e.autosize = n.exports));
  }
})(this, function (e, t) {
  "use strict";
  var n,
    o,
    p =
      "function" == typeof Map
        ? new Map()
        : ((n = []),
          (o = []),
          {
            has: function (e) {
              return -1 < n.indexOf(e);
            },
            get: function (e) {
              return o[n.indexOf(e)];
            },
            set: function (e, t) {
              -1 === n.indexOf(e) && (n.push(e), o.push(t));
            },
            delete: function (e) {
              var t = n.indexOf(e);
              -1 < t && (n.splice(t, 1), o.splice(t, 1));
            },
          }),
    c = function (e) {
      return new Event(e, { bubbles: !0 });
    };
  try {
    new Event("test");
  } catch (e) {
    c = function (e) {
      var t = document.createEvent("Event");
      return (t.initEvent(e, !0, !1), t);
    };
  }
  function r(r) {
    if (r && r.nodeName && "TEXTAREA" === r.nodeName && !p.has(r)) {
      var e,
        n = null,
        o = null,
        i = null,
        d = function () {
          r.clientWidth !== o && a();
        },
        l = function (t) {
          (window.removeEventListener("resize", d, !1),
            r.removeEventListener("input", a, !1),
            r.removeEventListener("keyup", a, !1),
            r.removeEventListener("autosize:destroy", l, !1),
            r.removeEventListener("autosize:update", a, !1),
            Object.keys(t).forEach(function (e) {
              r.style[e] = t[e];
            }),
            p.delete(r));
        }.bind(r, {
          height: r.style.height,
          resize: r.style.resize,
          overflowY: r.style.overflowY,
          overflowX: r.style.overflowX,
          wordWrap: r.style.wordWrap,
        });
      (r.addEventListener("autosize:destroy", l, !1),
        "onpropertychange" in r && "oninput" in r && r.addEventListener("keyup", a, !1),
        window.addEventListener("resize", d, !1),
        r.addEventListener("input", a, !1),
        r.addEventListener("autosize:update", a, !1),
        (r.style.overflowX = "hidden"),
        (r.style.wordWrap = "break-word"),
        p.set(r, { destroy: l, update: a }),
        "vertical" === (e = window.getComputedStyle(r, null)).resize
          ? (r.style.resize = "none")
          : "both" === e.resize && (r.style.resize = "horizontal"),
        (n =
          "content-box" === e.boxSizing
            ? -(parseFloat(e.paddingTop) + parseFloat(e.paddingBottom))
            : parseFloat(e.borderTopWidth) + parseFloat(e.borderBottomWidth)),
        isNaN(n) && (n = 0),
        a());
    }
    function s(e) {
      var t = r.style.width;
      ((r.style.width = "0px"), r.offsetWidth, (r.style.width = t), (r.style.overflowY = e));
    }
    function u() {
      if (0 !== r.scrollHeight) {
        var e = (function (e) {
            for (var t = []; e && e.parentNode && e.parentNode instanceof Element;)
              (e.parentNode.scrollTop && t.push({ node: e.parentNode, scrollTop: e.parentNode.scrollTop }),
                (e = e.parentNode));
            return t;
          })(r),
          t = document.documentElement && document.documentElement.scrollTop;
        ((r.style.height = ""),
          (r.style.height = r.scrollHeight + n + "px"),
          (o = r.clientWidth),
          e.forEach(function (e) {
            e.node.scrollTop = e.scrollTop;
          }),
          t && (document.documentElement.scrollTop = t));
      }
    }
    function a() {
      u();
      var e = Math.round(parseFloat(r.style.height)),
        t = window.getComputedStyle(r, null),
        n = "content-box" === t.boxSizing ? Math.round(parseFloat(t.height)) : r.offsetHeight;
      if (
        (n < e
          ? "hidden" === t.overflowY &&
            (s("scroll"),
            u(),
            (n =
              "content-box" === t.boxSizing
                ? Math.round(parseFloat(window.getComputedStyle(r, null).height))
                : r.offsetHeight))
          : "hidden" !== t.overflowY &&
            (s("hidden"),
            u(),
            (n =
              "content-box" === t.boxSizing
                ? Math.round(parseFloat(window.getComputedStyle(r, null).height))
                : r.offsetHeight)),
        i !== n)
      ) {
        i = n;
        var o = c("autosize:resized");
        try {
          r.dispatchEvent(o);
        } catch (e) {}
      }
    }
  }
  function i(e) {
    var t = p.get(e);
    t && t.destroy();
  }
  function d(e) {
    var t = p.get(e);
    t && t.update();
  }
  var l = null;
  ("undefined" == typeof window || "function" != typeof window.getComputedStyle
    ? (((l = function (e) {
        return e;
      }).destroy = function (e) {
        return e;
      }),
      (l.update = function (e) {
        return e;
      }))
    : (((l = function (e, t) {
        return (
          e &&
            Array.prototype.forEach.call(e.length ? e : [e], function (e) {
              return r(e);
            }),
          e
        );
      }).destroy = function (e) {
        return (e && Array.prototype.forEach.call(e.length ? e : [e], i), e);
      }),
      (l.update = function (e) {
        return (e && Array.prototype.forEach.call(e.length ? e : [e], d), e);
      })),
    (t.default = l),
    (e.exports = t.default));
});
(function (global, factory) {
  typeof exports === "object" && typeof module !== "undefined"
    ? (module.exports = factory())
    : typeof define === "function" && define.amd
      ? define(factory)
      : (global["vue-scrollto"] = factory());
})(this, function () {
  "use strict";
  var NEWTON_ITERATIONS = 4;
  var NEWTON_MIN_SLOPE = 0.001;
  var SUBDIVISION_PRECISION = 0.0000001;
  var SUBDIVISION_MAX_ITERATIONS = 10;
  var kSplineTableSize = 11;
  var kSampleStepSize = 1.0 / (kSplineTableSize - 1.0);
  var float32ArraySupported = typeof Float32Array === "function";
  function A(aA1, aA2) {
    return 1.0 - 3.0 * aA2 + 3.0 * aA1;
  }
  function B(aA1, aA2) {
    return 3.0 * aA2 - 6.0 * aA1;
  }
  function C(aA1) {
    return 3.0 * aA1;
  }
  function calcBezier(aT, aA1, aA2) {
    return ((A(aA1, aA2) * aT + B(aA1, aA2)) * aT + C(aA1)) * aT;
  }
  function getSlope(aT, aA1, aA2) {
    return 3.0 * A(aA1, aA2) * aT * aT + 2.0 * B(aA1, aA2) * aT + C(aA1);
  }
  function binarySubdivide(aX, aA, aB, mX1, mX2) {
    var currentX,
      currentT,
      i = 0;
    do {
      currentT = aA + (aB - aA) / 2.0;
      currentX = calcBezier(currentT, mX1, mX2) - aX;
      if (currentX > 0.0) {
        aB = currentT;
      } else {
        aA = currentT;
      }
    } while (Math.abs(currentX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS);
    return currentT;
  }
  function newtonRaphsonIterate(aX, aGuessT, mX1, mX2) {
    for (var i = 0; i < NEWTON_ITERATIONS; ++i) {
      var currentSlope = getSlope(aGuessT, mX1, mX2);
      if (currentSlope === 0.0) {
        return aGuessT;
      }
      var currentX = calcBezier(aGuessT, mX1, mX2) - aX;
      aGuessT -= currentX / currentSlope;
    }
    return aGuessT;
  }
  var index = function bezier(mX1, mY1, mX2, mY2) {
    if (!(0 <= mX1 && mX1 <= 1 && 0 <= mX2 && mX2 <= 1)) {
      throw new Error("bezier x values must be in [0, 1] range");
    }
    var sampleValues = float32ArraySupported ? new Float32Array(kSplineTableSize) : new Array(kSplineTableSize);
    if (mX1 !== mY1 || mX2 !== mY2) {
      for (var i = 0; i < kSplineTableSize; ++i) {
        sampleValues[i] = calcBezier(i * kSampleStepSize, mX1, mX2);
      }
    }
    function getTForX(aX) {
      var intervalStart = 0.0;
      var currentSample = 1;
      var lastSample = kSplineTableSize - 1;
      for (; currentSample !== lastSample && sampleValues[currentSample] <= aX; ++currentSample) {
        intervalStart += kSampleStepSize;
      }
      --currentSample;
      var dist = (aX - sampleValues[currentSample]) / (sampleValues[currentSample + 1] - sampleValues[currentSample]);
      var guessForT = intervalStart + dist * kSampleStepSize;
      var initialSlope = getSlope(guessForT, mX1, mX2);
      if (initialSlope >= NEWTON_MIN_SLOPE) {
        return newtonRaphsonIterate(aX, guessForT, mX1, mX2);
      } else if (initialSlope === 0.0) {
        return guessForT;
      } else {
        return binarySubdivide(aX, intervalStart, intervalStart + kSampleStepSize, mX1, mX2);
      }
    }
    return function BezierEasing(x) {
      if (mX1 === mY1 && mX2 === mY2) {
        return x;
      }
      if (x === 0) {
        return 0;
      }
      if (x === 1) {
        return 1;
      }
      return calcBezier(getTForX(x), mY1, mY2);
    };
  };
  var easings = {
    ease: [0.25, 0.1, 0.25, 1.0],
    linear: [0.0, 0.0, 1.0, 1.0],
    "ease-in": [0.42, 0.0, 1.0, 1.0],
    "ease-out": [0.0, 0.0, 0.58, 1.0],
    "ease-in-out": [0.42, 0.0, 0.58, 1.0],
  };
  var supportsPassive = false;
  try {
    var opts = Object.defineProperty({}, "passive", {
      get: function get() {
        supportsPassive = true;
      },
    });
    window.addEventListener("test", null, opts);
  } catch (e) {}
  var _ = {
    $: function $(selector) {
      if (typeof selector !== "string") {
        return selector;
      }
      return document.querySelector(selector);
    },
    on: function on(element, events, handler) {
      var opts = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : { passive: false };
      if (!(events instanceof Array)) {
        events = [events];
      }
      for (var i = 0; i < events.length; i++) {
        element.addEventListener(events[i], handler, supportsPassive ? opts : false);
      }
    },
    off: function off(element, events, handler) {
      if (!(events instanceof Array)) {
        events = [events];
      }
      for (var i = 0; i < events.length; i++) {
        element.removeEventListener(events[i], handler);
      }
    },
    cumulativeOffset: function cumulativeOffset(element) {
      var top = 0;
      var left = 0;
      do {
        top += element.offsetTop || 0;
        left += element.offsetLeft || 0;
        element = element.offsetParent;
      } while (element);
      return { top: top, left: left };
    },
  };
  var _typeof =
    typeof Symbol === "function" && typeof Symbol.iterator === "symbol"
      ? function (obj) {
          return typeof obj;
        }
      : function (obj) {
          return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype
            ? "symbol"
            : typeof obj;
        };
  var _extends =
    Object.assign ||
    function (target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        for (var key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            target[key] = source[key];
          }
        }
      }
      return target;
    };
  var abortEvents = ["mousedown", "wheel", "DOMMouseScroll", "mousewheel", "keyup", "touchmove"];
  var defaults$$1 = {
    container: "body",
    duration: 500,
    easing: "ease",
    offset: 0,
    cancelable: true,
    onDone: false,
    onCancel: false,
    x: false,
    y: true,
  };
  function setDefaults(options) {
    defaults$$1 = _extends({}, defaults$$1, options);
  }
  var scroller = function scroller() {
    var element = void 0;
    var container = void 0;
    var duration = void 0;
    var easing = void 0;
    var offset = void 0;
    var cancelable = void 0;
    var onDone = void 0;
    var onCancel = void 0;
    var x = void 0;
    var y = void 0;
    var initialX = void 0;
    var targetX = void 0;
    var initialY = void 0;
    var targetY = void 0;
    var diffX = void 0;
    var diffY = void 0;
    var abort = void 0;
    var abortEv = void 0;
    var abortFn = function abortFn(e) {
      if (!cancelable) return;
      abortEv = e;
      abort = true;
    };
    var easingFn = void 0;
    var timeStart = void 0;
    var timeElapsed = void 0;
    var progress = void 0;
    function scrollTop(container) {
      var scrollTop = container.scrollTop;
      if (container.tagName.toLowerCase() === "body") {
        scrollTop = scrollTop || document.documentElement.scrollTop;
      }
      return scrollTop;
    }
    function scrollLeft(container) {
      var scrollLeft = container.scrollLeft;
      if (container.tagName.toLowerCase() === "body") {
        scrollLeft = scrollLeft || document.documentElement.scrollLeft;
      }
      return scrollLeft;
    }
    function step(timestamp) {
      if (abort) return done();
      if (!timeStart) timeStart = timestamp;
      timeElapsed = timestamp - timeStart;
      progress = Math.min(timeElapsed / duration, 1);
      progress = easingFn(progress);
      topLeft(container, initialY + diffY * progress, initialX + diffX * progress);
      timeElapsed < duration ? window.requestAnimationFrame(step) : done();
    }
    function done() {
      if (!abort) topLeft(container, targetY, targetX);
      timeStart = false;
      _.off(container, abortEvents, abortFn);
      if (abort && onCancel) onCancel(abortEv);
      if (!abort && onDone) onDone();
    }
    function topLeft(element, top, left) {
      if (y) element.scrollTop = top;
      if (x) element.scrollLeft = left;
      if (element.tagName.toLowerCase() === "body") {
        if (y) document.documentElement.scrollTop = top;
        if (x) document.documentElement.scrollLeft = left;
      }
    }
    function scrollTo(target, _duration) {
      var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
      if ((typeof _duration === "undefined" ? "undefined" : _typeof(_duration)) === "object") {
        options = _duration;
      } else if (typeof _duration === "number") {
        options.duration = _duration;
      }
      element = _.$(target);
      if (!element) {
        return console.warn("[vue-scrollto warn]: Trying to scroll to an element that is not on the page: " + target);
      }
      container = _.$(options.container || defaults$$1.container);
      duration = options.duration || defaults$$1.duration;
      easing = options.easing || defaults$$1.easing;
      offset = options.offset || defaults$$1.offset;
      cancelable = options.cancelable !== false;
      onDone = options.onDone || defaults$$1.onDone;
      onCancel = options.onCancel || defaults$$1.onCancel;
      x = options.x === undefined ? defaults$$1.x : options.x;
      y = options.y === undefined ? defaults$$1.y : options.y;
      var cumulativeOffset = _.cumulativeOffset(element);
      initialY = scrollTop(container);
      targetY = cumulativeOffset.top - container.offsetTop + offset;
      initialX = scrollLeft(container);
      targetX = cumulativeOffset.left - container.offsetLeft + offset;
      abort = false;
      diffY = targetY - initialY;
      diffX = targetX - initialX;
      if (typeof easing === "string") {
        easing = easings[easing] || easings["ease"];
      }
      easingFn = index.apply(index, easing);
      if (!diffY && !diffX) return;
      _.on(container, abortEvents, abortFn, { passive: true });
      window.requestAnimationFrame(step);
      return function () {
        abortEv = null;
        abort = true;
      };
    }
    return scrollTo;
  };
  var _scroller = scroller();
  var bindings = [];
  function deleteBinding(el) {
    for (var i = 0; i < bindings.length; ++i) {
      if (bindings[i].el === el) {
        bindings.splice(i, 1);
        return true;
      }
    }
    return false;
  }
  function findBinding(el) {
    for (var i = 0; i < bindings.length; ++i) {
      if (bindings[i].el === el) {
        return bindings[i];
      }
    }
  }
  function getBinding(el) {
    var binding = findBinding(el);
    if (binding) {
      return binding;
    }
    bindings.push((binding = { el: el, binding: {} }));
    return binding;
  }
  function handleClick(e) {
    e.preventDefault();
    var ctx = getBinding(this).binding;
    if (typeof ctx.value === "string") {
      return _scroller(ctx.value);
    }
    _scroller(ctx.value.el || ctx.value.element, ctx.value);
  }
  var VueScrollTo$1 = {
    bind: function bind(el, binding) {
      getBinding(el).binding = binding;
      _.on(el, "click", handleClick);
    },
    unbind: function unbind(el) {
      deleteBinding(el);
      _.off(el, "click", handleClick);
    },
    update: function update(el, binding) {
      getBinding(el).binding = binding;
    },
    scrollTo: _scroller,
    bindings: bindings,
  };
  var install = function install(Vue, options) {
    if (options) setDefaults(options);
    Vue.directive("scroll-to", VueScrollTo$1);
    Vue.prototype.$scrollTo = VueScrollTo$1.scrollTo;
  };
  if (typeof window !== "undefined" && window.Vue) {
    window.VueScrollTo = VueScrollTo$1;
    window.VueScrollTo.setDefaults = setDefaults;
    Vue.use(install);
  }
  VueScrollTo$1.install = install;
  return VueScrollTo$1;
});

!(function (t, e) {
  "object" == typeof exports && "undefined" != typeof module
    ? (module.exports = e())
    : "function" == typeof define && define.amd
      ? define(e)
      : (t.StickySidebar = e());
})(this, function () {
  "use strict";
  function t(t, e) {
    if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function");
  }
  var e = (function () {
      function t(t, e) {
        for (var i = 0; i < e.length; i++) {
          var n = e[i];
          ((n.enumerable = n.enumerable || !1),
            (n.configurable = !0),
            "value" in n && (n.writable = !0),
            Object.defineProperty(t, n.key, n));
        }
      }
      return function (e, i, n) {
        return (i && t(e.prototype, i), n && t(e, n), e);
      };
    })(),
    i = (function () {
      var i = ".stickySidebar",
        n = {
          topSpacing: 0,
          bottomSpacing: 0,
          containerSelector: !1,
          innerWrapperSelector: ".inner-wrapper-sticky",
          stickyClass: "is-affixed",
          resizeSensor: !0,
          minWidth: !1,
        };
      return (function () {
        function s(e) {
          var i = this,
            o = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : {};
          if (
            (t(this, s),
            (this.options = s.extend(n, o)),
            (this.sidebar = "string" == typeof e ? document.querySelector(e) : e),
            void 0 === this.sidebar)
          )
            throw new Error("There is no specific sidebar element.");
          ((this.sidebarInner = !1),
            (this.container = this.sidebar.parentElement),
            (this.affixedType = "STATIC"),
            (this.direction = "down"),
            (this.support = { transform: !1, transform3d: !1 }),
            (this._initialized = !1),
            (this._breakpoint = !1),
            (this._resizeListeners = []),
            (this.dimensions = {
              translateY: 0,
              topSpacing: 0,
              bottomSpacing: 0,
              sidebarHeight: 0,
              sidebarWidth: 0,
              containerTop: 0,
              containerHeight: 0,
              viewportHeight: 0,
              viewportTop: 0,
              lastViewportTop: 0,
            }),
            ["handleEvent"].forEach(function (t) {
              i[t] = i[t].bind(i);
            }),
            this.initialize());
        }
        return (
          e(
            s,
            [
              {
                key: "initialize",
                value: function () {
                  var t = this;
                  if (
                    (this._setSupportFeatures(),
                    this.options.innerWrapperSelector &&
                      ((this.sidebarInner = this.sidebar.querySelector(this.options.innerWrapperSelector)),
                      null === this.sidebarInner && (this.sidebarInner = !1)),
                    !this.sidebarInner)
                  ) {
                    var e = document.createElement("div");
                    for (
                      e.setAttribute("class", "inner-wrapper-sticky"), this.sidebar.appendChild(e);
                      this.sidebar.firstChild != e;
                    )
                      e.appendChild(this.sidebar.firstChild);
                    this.sidebarInner = this.sidebar.querySelector(".inner-wrapper-sticky");
                  }
                  if (this.options.containerSelector) {
                    var i = document.querySelectorAll(this.options.containerSelector);
                    if (
                      ((i = Array.prototype.slice.call(i)).forEach(function (e, i) {
                        e.contains(t.sidebar) && (t.container = e);
                      }),
                      !i.length)
                    )
                      throw new Error("The container does not contains on the sidebar.");
                  }
                  ("function" != typeof this.options.topSpacing &&
                    (this.options.topSpacing = parseInt(this.options.topSpacing) || 0),
                    "function" != typeof this.options.bottomSpacing &&
                      (this.options.bottomSpacing = parseInt(this.options.bottomSpacing) || 0),
                    this._widthBreakpoint(),
                    this.calcDimensions(),
                    this.stickyPosition(),
                    this.bindEvents(),
                    (this._initialized = !0));
                },
              },
              {
                key: "bindEvents",
                value: function () {
                  (window.addEventListener("resize", this, { passive: !0 }),
                    window.addEventListener("scroll", this, { passive: !0 }),
                    this.sidebar.addEventListener("update" + i, this),
                    this.options.resizeSensor &&
                      "undefined" != typeof ResizeSensor &&
                      (new ResizeSensor(this.sidebarInner, this.handleEvent),
                      new ResizeSensor(this.container, this.handleEvent)));
                },
              },
              {
                key: "handleEvent",
                value: function (t) {
                  this.updateSticky(t);
                },
              },
              {
                key: "calcDimensions",
                value: function () {
                  if (!this._breakpoint) {
                    var t = this.dimensions;
                    ((t.containerTop = s.offsetRelative(this.container).top),
                      (t.containerHeight = this.container.clientHeight),
                      (t.containerBottom = t.containerTop + t.containerHeight),
                      (t.sidebarHeight = this.sidebarInner.offsetHeight),
                      (t.sidebarWidth = this.sidebar.offsetWidth),
                      (t.viewportHeight = window.innerHeight),
                      this._calcDimensionsWithScroll());
                  }
                },
              },
              {
                key: "_calcDimensionsWithScroll",
                value: function () {
                  var t = this.dimensions;
                  ((t.sidebarLeft = s.offsetRelative(this.sidebar).left),
                    (t.viewportTop = document.documentElement.scrollTop || document.body.scrollTop),
                    (t.viewportBottom = t.viewportTop + t.viewportHeight),
                    (t.viewportLeft = document.documentElement.scrollLeft || document.body.scrollLeft),
                    (t.topSpacing = this.options.topSpacing),
                    (t.bottomSpacing = this.options.bottomSpacing),
                    "function" == typeof t.topSpacing && (t.topSpacing = parseInt(t.topSpacing(this.sidebar)) || 0),
                    "function" == typeof t.bottomSpacing &&
                      (t.bottomSpacing = parseInt(t.bottomSpacing(this.sidebar)) || 0));
                },
              },
              {
                key: "isSidebarFitsViewport",
                value: function () {
                  return this.dimensions.sidebarHeight < this.dimensions.viewportHeight;
                },
              },
              {
                key: "observeScrollDir",
                value: function () {
                  var t = this.dimensions;
                  if (t.lastViewportTop !== t.viewportTop) {
                    var e = "down" === this.direction ? Math.min : Math.max;
                    t.viewportTop === e(t.viewportTop, t.lastViewportTop) &&
                      (this.direction = "down" === this.direction ? "up" : "down");
                  }
                },
              },
              {
                key: "getAffixType",
                value: function () {
                  var t = this.dimensions,
                    e = !1;
                  this._calcDimensionsWithScroll();
                  var i = t.sidebarHeight + t.containerTop,
                    n = t.viewportTop + t.topSpacing,
                    s = t.viewportBottom - t.bottomSpacing;
                  return (
                    "up" === this.direction
                      ? n <= t.containerTop
                        ? ((t.translateY = 0), (e = "STATIC"))
                        : n <= t.translateY + t.containerTop
                          ? ((t.translateY = n - t.containerTop), (e = "VIEWPORT-TOP"))
                          : !this.isSidebarFitsViewport() && t.containerTop <= n && (e = "VIEWPORT-UNBOTTOM")
                      : this.isSidebarFitsViewport()
                        ? t.sidebarHeight + n >= t.containerBottom
                          ? ((t.translateY = t.containerBottom - i), (e = "CONTAINER-BOTTOM"))
                          : n >= t.containerTop && ((t.translateY = n - t.containerTop), (e = "VIEWPORT-TOP"))
                        : t.containerBottom <= s
                          ? ((t.translateY = t.containerBottom - i), (e = "CONTAINER-BOTTOM"))
                          : i + t.translateY <= s
                            ? ((t.translateY = s - i), (e = "VIEWPORT-BOTTOM"))
                            : t.containerTop + t.translateY <= n && (e = "VIEWPORT-UNBOTTOM"),
                    (t.translateY = Math.max(0, t.translateY)),
                    (t.translateY = Math.min(t.containerHeight, t.translateY)),
                    (t.lastViewportTop = t.viewportTop),
                    e
                  );
                },
              },
              {
                key: "_getStyle",
                value: function (t) {
                  if (void 0 !== t) {
                    var e = { inner: {}, outer: {} },
                      i = this.dimensions;
                    switch (t) {
                      case "VIEWPORT-TOP":
                        e.inner = {
                          position: "fixed",
                          top: this.options.topSpacing,
                          left: i.sidebarLeft - i.viewportLeft,
                          width: i.sidebarWidth,
                        };
                        break;
                      case "VIEWPORT-BOTTOM":
                        e.inner = {
                          position: "fixed",
                          top: "auto",
                          left: i.sidebarLeft,
                          bottom: this.options.bottomSpacing,
                          width: i.sidebarWidth,
                        };
                        break;
                      case "CONTAINER-BOTTOM":
                      case "VIEWPORT-UNBOTTOM":
                        var n = this._getTranslate(0, i.translateY + "px");
                        e.inner = n
                          ? { transform: n }
                          : { position: "absolute", top: i.translateY, width: i.sidebarWidth };
                    }
                    switch (t) {
                      case "VIEWPORT-TOP":
                      case "VIEWPORT-BOTTOM":
                      case "VIEWPORT-UNBOTTOM":
                      case "CONTAINER-BOTTOM":
                        e.outer = { height: i.sidebarHeight, position: "relative" };
                    }
                    return (
                      (e.outer = s.extend({ height: "", position: "" }, e.outer)),
                      (e.inner = s.extend(
                        {
                          position: "relative",
                          top: "",
                          left: "",
                          bottom: "",
                          width: "",
                          transform: this._getTranslate(),
                        },
                        e.inner,
                      )),
                      e
                    );
                  }
                },
              },
              {
                key: "stickyPosition",
                value: function (t) {
                  if (!this._breakpoint) {
                    t = t || !1;
                    var e = this.getAffixType(),
                      n = this._getStyle(e);
                    if ((this.affixedType != e || t) && e) {
                      var o = "affix." + e.toLowerCase().replace("viewport-", "") + i;
                      (s.eventTrigger(this.sidebar, o),
                        "STATIC" === e
                          ? s.removeClass(this.sidebar, this.options.stickyClass)
                          : s.addClass(this.sidebar, this.options.stickyClass));
                      for (var r in n.outer) this.sidebar.style[r] = n.outer[r];
                      for (var a in n.inner) {
                        var c = "number" == typeof n.inner[a] ? "px" : "";
                        this.sidebarInner.style[a] = n.inner[a] + c;
                      }
                      var p = "affixed." + e.toLowerCase().replace("viewport", "") + i;
                      s.eventTrigger(this.sidebar, p);
                    } else this._initialized && (this.sidebarInner.style.left = n.inner.left);
                    this.affixedType = e;
                  }
                },
              },
              {
                key: "_widthBreakpoint",
                value: function () {
                  window.innerWidth <= this.options.minWidth
                    ? ((this._breakpoint = !0),
                      (this.affixedType = "STATIC"),
                      this.sidebar.removeAttribute("style"),
                      s.removeClass(this.sidebar, this.options.stickyClass),
                      this.sidebarInner.removeAttribute("style"))
                    : (this._breakpoint = !1);
                },
              },
              {
                key: "updateSticky",
                value: function () {
                  var t = this,
                    e = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : {};
                  this._running ||
                    ((this._running = !0),
                    (function (e) {
                      requestAnimationFrame(function () {
                        switch (e) {
                          case "scroll":
                            (t._calcDimensionsWithScroll(), t.observeScrollDir(), t.stickyPosition());
                            break;
                          case "resize":
                          default:
                            (t._widthBreakpoint(), t.calcDimensions(), t.stickyPosition(!0));
                        }
                        t._running = !1;
                      });
                    })(e.type));
                },
              },
              {
                key: "_setSupportFeatures",
                value: function () {
                  var t = this.support;
                  ((t.transform = s.supportTransform()), (t.transform3d = s.supportTransform(!0)));
                },
              },
              {
                key: "_getTranslate",
                value: function () {
                  var t = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : 0,
                    e = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : 0,
                    i = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : 0;
                  return this.support.transform3d
                    ? "translate3d(" + t + ", " + e + ", " + i + ")"
                    : !!this.support.translate && "translate(" + t + ", " + e + ")";
                },
              },
              {
                key: "destroy",
                value: function () {
                  (window.removeEventListener("resize", this),
                    window.removeEventListener("scroll", this),
                    this.sidebar.classList.remove(this.options.stickyClass),
                    (this.sidebar.style.minHeight = ""),
                    this.sidebar.removeEventListener("update" + i, this));
                  var t = { inner: {}, outer: {} };
                  ((t.inner = { position: "", top: "", left: "", bottom: "", width: "", transform: "" }),
                    (t.outer = { height: "", position: "" }));
                  for (var e in t.outer) this.sidebar.style[e] = t.outer[e];
                  for (var n in t.inner) this.sidebarInner.style[n] = t.inner[n];
                  this.options.resizeSensor &&
                    "undefined" != typeof ResizeSensor &&
                    (ResizeSensor.detach(this.sidebarInner, this.handleEvent),
                    ResizeSensor.detach(this.container, this.handleEvent));
                },
              },
            ],
            [
              {
                key: "supportTransform",
                value: function (t) {
                  var e = !1,
                    i = t ? "perspective" : "transform",
                    n = i.charAt(0).toUpperCase() + i.slice(1),
                    s = ["Webkit", "Moz", "O", "ms"],
                    o = document.createElement("support").style;
                  return (
                    (i + " " + s.join(n + " ") + n).split(" ").forEach(function (t, i) {
                      if (void 0 !== o[t]) return ((e = t), !1);
                    }),
                    e
                  );
                },
              },
              {
                key: "eventTrigger",
                value: function (t, e, i) {
                  try {
                    var n = new CustomEvent(e, { detail: i });
                  } catch (t) {
                    (n = document.createEvent("CustomEvent")).initCustomEvent(e, !0, !0, i);
                  }
                  t.dispatchEvent(n);
                },
              },
              {
                key: "extend",
                value: function (t, e) {
                  var i = {};
                  for (var n in t) void 0 !== e[n] ? (i[n] = e[n]) : (i[n] = t[n]);
                  return i;
                },
              },
              {
                key: "offsetRelative",
                value: function (t) {
                  var e = { left: 0, top: 0 };
                  do {
                    var i = t.offsetTop,
                      n = t.offsetLeft;
                    (isNaN(i) || (e.top += i), isNaN(n) || (e.left += n));
                  } while ((t = t.offsetParent));
                  return e;
                },
              },
              {
                key: "addClass",
                value: function (t, e) {
                  s.hasClass(t, e) || (t.classList ? t.classList.add(e) : (t.className += " " + e));
                },
              },
              {
                key: "removeClass",
                value: function (t, e) {
                  s.hasClass(t, e) &&
                    (t.classList
                      ? t.classList.remove(e)
                      : (t.className = t.className.replace(
                          new RegExp("(^|\\b)" + e.split(" ").join("|") + "(\\b|$)", "gi"),
                          " ",
                        )));
                },
              },
              {
                key: "hasClass",
                value: function (t, e) {
                  return t.classList
                    ? t.classList.contains(e)
                    : new RegExp("(^| )" + e + "( |$)", "gi").test(t.className);
                },
              },
            ],
          ),
          s
        );
      })();
    })();
  return ((window.StickySidebar = i), i);
});
!(function (n, t) {
  "object" == typeof exports && "undefined" != typeof module
    ? (module.exports = t())
    : "function" == typeof define && define.amd
      ? define(t)
      : ((n = "undefined" != typeof globalThis ? globalThis : n || self).LazyLoad = t());
})(this, function () {
  "use strict";
  function n() {
    return (
      (n =
        Object.assign ||
        function (n) {
          for (var t = 1; t < arguments.length; t++) {
            var e = arguments[t];
            for (var i in e) Object.prototype.hasOwnProperty.call(e, i) && (n[i] = e[i]);
          }
          return n;
        }),
      n.apply(this, arguments)
    );
  }
  var t = "undefined" != typeof window,
    e =
      (t && !("onscroll" in window)) ||
      ("undefined" != typeof navigator && /(gle|ing|ro)bot|crawl|spider/i.test(navigator.userAgent)),
    i = t && "IntersectionObserver" in window,
    o = t && "classList" in document.createElement("p"),
    a = t && window.devicePixelRatio > 1,
    r = {
      elements_selector: ".lazy",
      container: e || t ? document : null,
      threshold: 300,
      thresholds: null,
      data_src: "src",
      data_srcset: "srcset",
      data_sizes: "sizes",
      data_bg: "bg",
      data_bg_hidpi: "bg-hidpi",
      data_bg_multi: "bg-multi",
      data_bg_multi_hidpi: "bg-multi-hidpi",
      data_bg_set: "bg-set",
      data_poster: "poster",
      class_applied: "applied",
      class_loading: "loading",
      class_loaded: "loaded",
      class_error: "error",
      class_entered: "entered",
      class_exited: "exited",
      unobserve_completed: !0,
      unobserve_entered: !1,
      cancel_on_exit: !0,
      callback_enter: null,
      callback_exit: null,
      callback_applied: null,
      callback_loading: null,
      callback_loaded: null,
      callback_error: null,
      callback_finish: null,
      callback_cancel: null,
      use_native: !1,
      restore_on_error: !1,
    },
    c = function (t) {
      return n({}, r, t);
    },
    l = function (n, t) {
      var e,
        i = "LazyLoad::Initialized",
        o = new n(t);
      try {
        e = new CustomEvent(i, { detail: { instance: o } });
      } catch (n) {
        (e = document.createEvent("CustomEvent")).initCustomEvent(i, !1, !1, { instance: o });
      }
      window.dispatchEvent(e);
    },
    u = "src",
    s = "srcset",
    d = "sizes",
    f = "poster",
    _ = "llOriginalAttrs",
    g = "data",
    v = "loading",
    b = "loaded",
    m = "applied",
    p = "error",
    h = "native",
    E = "data-",
    I = "ll-status",
    y = function (n, t) {
      return n.getAttribute(E + t);
    },
    k = function (n) {
      return y(n, I);
    },
    w = function (n, t) {
      return (function (n, t, e) {
        var i = "data-ll-status";
        null !== e ? n.setAttribute(i, e) : n.removeAttribute(i);
      })(n, 0, t);
    },
    A = function (n) {
      return w(n, null);
    },
    L = function (n) {
      return null === k(n);
    },
    O = function (n) {
      return k(n) === h;
    },
    x = [v, b, m, p],
    C = function (n, t, e, i) {
      n && (void 0 === i ? (void 0 === e ? n(t) : n(t, e)) : n(t, e, i));
    },
    N = function (n, t) {
      o ? n.classList.add(t) : (n.className += (n.className ? " " : "") + t);
    },
    M = function (n, t) {
      o
        ? n.classList.remove(t)
        : (n.className = n.className
            .replace(new RegExp("(^|\\s+)" + t + "(\\s+|$)"), " ")
            .replace(/^\s+/, "")
            .replace(/\s+$/, ""));
    },
    z = function (n) {
      return n.llTempImage;
    },
    T = function (n, t) {
      if (t) {
        var e = t._observer;
        e && e.unobserve(n);
      }
    },
    R = function (n, t) {
      n && (n.loadingCount += t);
    },
    G = function (n, t) {
      n && (n.toLoadCount = t);
    },
    j = function (n) {
      for (var t, e = [], i = 0; (t = n.children[i]); i += 1) "SOURCE" === t.tagName && e.push(t);
      return e;
    },
    D = function (n, t) {
      var e = n.parentNode;
      e && "PICTURE" === e.tagName && j(e).forEach(t);
    },
    H = function (n, t) {
      j(n).forEach(t);
    },
    V = [u],
    F = [u, f],
    B = [u, s, d],
    J = [g],
    P = function (n) {
      return !!n[_];
    },
    S = function (n) {
      return n[_];
    },
    U = function (n) {
      return delete n[_];
    },
    $ = function (n, t) {
      if (!P(n)) {
        var e = {};
        (t.forEach(function (t) {
          e[t] = n.getAttribute(t);
        }),
          (n[_] = e));
      }
    },
    q = function (n, t) {
      if (P(n)) {
        var e = S(n);
        t.forEach(function (t) {
          !(function (n, t, e) {
            e ? n.setAttribute(t, e) : n.removeAttribute(t);
          })(n, t, e[t]);
        });
      }
    },
    K = function (n, t, e) {
      (N(n, t.class_applied), w(n, m), e && (t.unobserve_completed && T(n, t), C(t.callback_applied, n, e)));
    },
    Q = function (n, t, e) {
      (N(n, t.class_loading), w(n, v), e && (R(e, 1), C(t.callback_loading, n, e)));
    },
    W = function (n, t, e) {
      e && n.setAttribute(t, e);
    },
    X = function (n, t) {
      (W(n, d, y(n, t.data_sizes)), W(n, s, y(n, t.data_srcset)), W(n, u, y(n, t.data_src)));
    },
    Y = {
      IMG: function (n, t) {
        (D(n, function (n) {
          ($(n, B), X(n, t));
        }),
          $(n, B),
          X(n, t));
      },
      IFRAME: function (n, t) {
        ($(n, V), W(n, u, y(n, t.data_src)));
      },
      VIDEO: function (n, t) {
        (H(n, function (n) {
          ($(n, V), W(n, u, y(n, t.data_src)));
        }),
          $(n, F),
          W(n, f, y(n, t.data_poster)),
          W(n, u, y(n, t.data_src)),
          n.load());
      },
      OBJECT: function (n, t) {
        ($(n, J), W(n, g, y(n, t.data_src)));
      },
    },
    Z = ["IMG", "IFRAME", "VIDEO", "OBJECT"],
    nn = function (n, t) {
      !t ||
        (function (n) {
          return n.loadingCount > 0;
        })(t) ||
        (function (n) {
          return n.toLoadCount > 0;
        })(t) ||
        C(n.callback_finish, t);
    },
    tn = function (n, t, e) {
      (n.addEventListener(t, e), (n.llEvLisnrs[t] = e));
    },
    en = function (n, t, e) {
      n.removeEventListener(t, e);
    },
    on = function (n) {
      return !!n.llEvLisnrs;
    },
    an = function (n) {
      if (on(n)) {
        var t = n.llEvLisnrs;
        for (var e in t) {
          var i = t[e];
          en(n, e, i);
        }
        delete n.llEvLisnrs;
      }
    },
    rn = function (n, t, e) {
      (!(function (n) {
        delete n.llTempImage;
      })(n),
        R(e, -1),
        (function (n) {
          n && (n.toLoadCount -= 1);
        })(e),
        M(n, t.class_loading),
        t.unobserve_completed && T(n, e));
    },
    cn = function (n, t, e) {
      var i = z(n) || n;
      on(i) ||
        (function (n, t, e) {
          on(n) || (n.llEvLisnrs = {});
          var i = "VIDEO" === n.tagName ? "loadeddata" : "load";
          (tn(n, i, t), tn(n, "error", e));
        })(
          i,
          function (o) {
            (!(function (n, t, e, i) {
              var o = O(t);
              (rn(t, e, i), N(t, e.class_loaded), w(t, b), C(e.callback_loaded, t, i), o || nn(e, i));
            })(0, n, t, e),
              an(i));
          },
          function (o) {
            (!(function (n, t, e, i) {
              var o = O(t);
              (rn(t, e, i),
                N(t, e.class_error),
                w(t, p),
                C(e.callback_error, t, i),
                e.restore_on_error && q(t, B),
                o || nn(e, i));
            })(0, n, t, e),
              an(i));
          },
        );
    },
    ln = function (n, t, e) {
      !(function (n) {
        return Z.indexOf(n.tagName) > -1;
      })(n)
        ? (function (n, t, e) {
            (!(function (n) {
              n.llTempImage = document.createElement("IMG");
            })(n),
              cn(n, t, e),
              (function (n) {
                P(n) || (n[_] = { backgroundImage: n.style.backgroundImage });
              })(n),
              (function (n, t, e) {
                var i = y(n, t.data_bg),
                  o = y(n, t.data_bg_hidpi),
                  r = a && o ? o : i;
                r && ((n.style.backgroundImage = 'url("'.concat(r, '")')), z(n).setAttribute(u, r), Q(n, t, e));
              })(n, t, e),
              (function (n, t, e) {
                var i = y(n, t.data_bg_multi),
                  o = y(n, t.data_bg_multi_hidpi),
                  r = a && o ? o : i;
                r && ((n.style.backgroundImage = r), K(n, t, e));
              })(n, t, e),
              (function (n, t, e) {
                var i = y(n, t.data_bg_set);
                if (i) {
                  var o = i.split("|"),
                    a = o.map(function (n) {
                      return "image-set(".concat(n, ")");
                    });
                  ((n.style.backgroundImage = a.join()),
                    "" === n.style.backgroundImage &&
                      ((a = o.map(function (n) {
                        return "-webkit-image-set(".concat(n, ")");
                      })),
                      (n.style.backgroundImage = a.join())),
                    K(n, t, e));
                }
              })(n, t, e));
          })(n, t, e)
        : (function (n, t, e) {
            (cn(n, t, e),
              (function (n, t, e) {
                var i = Y[n.tagName];
                i && (i(n, t), Q(n, t, e));
              })(n, t, e));
          })(n, t, e);
    },
    un = function (n) {
      (n.removeAttribute(u), n.removeAttribute(s), n.removeAttribute(d));
    },
    sn = function (n) {
      (D(n, function (n) {
        q(n, B);
      }),
        q(n, B));
    },
    dn = {
      IMG: sn,
      IFRAME: function (n) {
        q(n, V);
      },
      VIDEO: function (n) {
        (H(n, function (n) {
          q(n, V);
        }),
          q(n, F),
          n.load());
      },
      OBJECT: function (n) {
        q(n, J);
      },
    },
    fn = function (n, t) {
      ((function (n) {
        var t = dn[n.tagName];
        t
          ? t(n)
          : (function (n) {
              if (P(n)) {
                var t = S(n);
                n.style.backgroundImage = t.backgroundImage;
              }
            })(n);
      })(n),
        (function (n, t) {
          L(n) ||
            O(n) ||
            (M(n, t.class_entered),
            M(n, t.class_exited),
            M(n, t.class_applied),
            M(n, t.class_loading),
            M(n, t.class_loaded),
            M(n, t.class_error));
        })(n, t),
        A(n),
        U(n));
    },
    _n = ["IMG", "IFRAME", "VIDEO"],
    gn = function (n) {
      return n.use_native && "loading" in HTMLImageElement.prototype;
    },
    vn = function (n, t, e) {
      n.forEach(function (n) {
        return (function (n) {
          return n.isIntersecting || n.intersectionRatio > 0;
        })(n)
          ? (function (n, t, e, i) {
              var o = (function (n) {
                return x.indexOf(k(n)) >= 0;
              })(n);
              (w(n, "entered"),
                N(n, e.class_entered),
                M(n, e.class_exited),
                (function (n, t, e) {
                  t.unobserve_entered && T(n, e);
                })(n, e, i),
                C(e.callback_enter, n, t, i),
                o || ln(n, e, i));
            })(n.target, n, t, e)
          : (function (n, t, e, i) {
              L(n) ||
                (N(n, e.class_exited),
                (function (n, t, e, i) {
                  e.cancel_on_exit &&
                    (function (n) {
                      return k(n) === v;
                    })(n) &&
                    "IMG" === n.tagName &&
                    (an(n),
                    (function (n) {
                      (D(n, function (n) {
                        un(n);
                      }),
                        un(n));
                    })(n),
                    sn(n),
                    M(n, e.class_loading),
                    R(i, -1),
                    A(n),
                    C(e.callback_cancel, n, t, i));
                })(n, t, e, i),
                C(e.callback_exit, n, t, i));
            })(n.target, n, t, e);
      });
    },
    bn = function (n) {
      return Array.prototype.slice.call(n);
    },
    mn = function (n) {
      return n.container.querySelectorAll(n.elements_selector);
    },
    pn = function (n) {
      return (function (n) {
        return k(n) === p;
      })(n);
    },
    hn = function (n, t) {
      return (function (n) {
        return bn(n).filter(L);
      })(n || mn(t));
    },
    En = function (n, e) {
      var o = c(n);
      ((this._settings = o),
        (this.loadingCount = 0),
        (function (n, t) {
          i &&
            !gn(n) &&
            (t._observer = new IntersectionObserver(
              function (e) {
                vn(e, n, t);
              },
              (function (n) {
                return {
                  root: n.container === document ? null : n.container,
                  rootMargin: n.thresholds || n.threshold + "px",
                };
              })(n),
            ));
        })(o, this),
        (function (n, e) {
          t &&
            ((e._onlineHandler = function () {
              !(function (n, t) {
                var e;
                (((e = mn(n)), bn(e).filter(pn)).forEach(function (t) {
                  (M(t, n.class_error), A(t));
                }),
                  t.update());
              })(n, e);
            }),
            window.addEventListener("online", e._onlineHandler));
        })(o, this),
        this.update(e));
    };
  return (
    (En.prototype = {
      update: function (n) {
        var t,
          o,
          a = this._settings,
          r = hn(n, a);
        (G(this, r.length),
          !e && i
            ? gn(a)
              ? (function (n, t, e) {
                  (n.forEach(function (n) {
                    -1 !== _n.indexOf(n.tagName) &&
                      (function (n, t, e) {
                        (n.setAttribute("loading", "lazy"),
                          cn(n, t, e),
                          (function (n, t) {
                            var e = Y[n.tagName];
                            e && e(n, t);
                          })(n, t),
                          w(n, h));
                      })(n, t, e);
                  }),
                    G(e, 0));
                })(r, a, this)
              : ((o = r),
                (function (n) {
                  n.disconnect();
                })((t = this._observer)),
                (function (n, t) {
                  t.forEach(function (t) {
                    n.observe(t);
                  });
                })(t, o))
            : this.loadAll(r));
      },
      destroy: function () {
        (this._observer && this._observer.disconnect(),
          t && window.removeEventListener("online", this._onlineHandler),
          mn(this._settings).forEach(function (n) {
            U(n);
          }),
          delete this._observer,
          delete this._settings,
          delete this._onlineHandler,
          delete this.loadingCount,
          delete this.toLoadCount);
      },
      loadAll: function (n) {
        var t = this,
          e = this._settings;
        hn(n, e).forEach(function (n) {
          (T(n, t), ln(n, e, t));
        });
      },
      restoreAll: function () {
        var n = this._settings;
        mn(n).forEach(function (t) {
          fn(t, n);
        });
      },
    }),
    (En.load = function (n, t) {
      var e = c(t);
      ln(n, e);
    }),
    (En.resetStatus = function (n) {
      A(n);
    }),
    t &&
      (function (n, t) {
        if (t)
          if (t.length) for (var e, i = 0; (e = t[i]); i += 1) l(n, e);
          else l(n, t);
      })(En, window.lazyLoadOptions),
    En
  );
});
!(function (e) {
  "function" == typeof define && define.amd ? define(e) : e();
})(function () {
  var e,
    t = [
      "scroll",
      "wheel",
      "touchstart",
      "touchmove",
      "touchenter",
      "touchend",
      "touchleave",
      "mouseout",
      "mouseleave",
      "mouseup",
      "mousedown",
      "mousemove",
      "mouseenter",
      "mousewheel",
      "mouseover",
    ];
  if (
    (function () {
      var e = !1;
      try {
        var t = Object.defineProperty({}, "passive", {
          get: function () {
            e = !0;
          },
        });
        (window.addEventListener("test", null, t), window.removeEventListener("test", null, t));
      } catch (e) {}
      return e;
    })()
  ) {
    var n = EventTarget.prototype.addEventListener;
    ((e = n),
      (EventTarget.prototype.addEventListener = function (n, o, r) {
        var i,
          s = "object" == typeof r && null !== r,
          u = s ? r.capture : r;
        (((r = s
          ? (function (e) {
              var t = Object.getOwnPropertyDescriptor(e, "passive");
              return t && !0 !== t.writable && void 0 === t.set ? Object.assign({}, e) : e;
            })(r)
          : {}).passive = void 0 !== (i = r.passive) ? i : -1 !== t.indexOf(n) && !0),
          (r.capture = void 0 !== u && u),
          e.call(this, n, o, r));
      }),
      (EventTarget.prototype.addEventListener._original = e));
  }
});
axios.defaults.timeout = 300000;
Vue.prototype.$http = axios;
Vue.prototype.$https = axios;
Vue.prototype.$b2JsonData = [];
var b2_rest_url = b2_global.rest_url + "b2/v1/";
const b2timedom = document.querySelectorAll(".b2timeago");
if (b2timedom.length > 0) {
  timeago.render(b2timedom, b2_global.language);
}
var b2zoom = new Zooming({
  enableGrab: true,
  scrollThreshold: 0,
  transitionDuration: 0.2,
  scaleBase: 0.96,
  scaleExtra: 1,
  customSize: "100%",
});
var B2ClientWidth = document.body.clientWidth;
const b2token = b2getCookie("b2_token");
var lazyLoadInstance = new LazyLoad({ elements_selector: ".lazy", threshold: 0 });
if (b2token) {
  Vue.prototype.$http.defaults.headers.common["Authorization"] = "Bearer " + b2token;
}
Vue.prototype.$store = new Vuex.Store({
  state: {
    userData: "",
    userRole: "",
    announcement: "",
    oauthLink: "",
    openOauth: false,
    authorData: "",
    carts: {},
    _carts: {},
    canImg: false,
    xieyi: 0,
  },
  mutations: {
    setUserData(state, data) {
      state.userData = data;
    },
    setUserRole(state, data) {
      state.userRole = data;
    },
    setAnnouncement(state, data) {
      state.announcement = data;
    },
    setOauthLink(state, data) {
      state.oauthLink = data;
    },
    setOpenOauth(state, data) {
      state.openOauth = data;
    },
    setauthorData(state, data) {
      state.authorData = data;
    },
    setcartsData(state, data) {
      state.carts = data;
    },
    set_cartsData(state, data) {
      state._carts = data;
    },
    setcanImage(state, data) {
      state.canImg = data;
    },
  },
});
var passiveSupported = false;
try {
  var options = Object.defineProperty({}, "passive", {
    get: function () {
      passiveSupported = true;
    },
  });
  window.addEventListener("test", null, options);
} catch (err) {}
b2WidgetImageLoaded();
function b2WidgetImageLoaded() {
  imagesLoaded(document.querySelectorAll(".widget-area"), function (instance) {
    b2SidebarSticky();
  });
}
function b2isWeixin() {
  var ua = navigator.userAgent.toLowerCase();
  return ua.match(/MicroMessenger/i) == "micromessenger";
}
document.ready = function (callback) {
  if (document.addEventListener) {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        document.removeEventListener("DOMContentLoaded", arguments.callee, false);
        callback();
      },
      passiveSupported ? { passive: true } : false,
    );
  } else if (document.attachEvent) {
    document.attachEvent("onreadystatechange", function () {
      if (document.readyState == "complete") {
        document.detachEvent("onreadystatechange", arguments.callee);
        callback();
      }
    });
  } else if (document.lastChild == document.body) {
    callback();
  }
};
var topsearch = new Vue({
  el: ".top-search",
  data: { type: "post", data: "", show: false, b2token: false },
  mounted() {
    if (!this.$refs.topsearch) return;
    this.b2token = b2token;
    const s = this.$refs.topsearch.getAttribute("data-search");
    this.data = JSON.parse(s);
    if (b2GetQueryVariable("type") && b2GetQueryVariable("s")) {
      this.type = b2GetQueryVariable("type");
    } else {
      this.type = Object.keys(this.data)[0];
    }
  },
});
const goodsBoxs = document.querySelectorAll(".module-products");
if (goodsBoxs.length > 0) {
  for (let i = 0; i < goodsBoxs.length; i++) {
    new Vue({
      el: goodsBoxs[i].querySelector(".shop-box"),
      data: { id: 0, opts: [], locked: false, paged: 1 },
      mounted() {
        this.opts = JSON.parse(goodsBoxs[i].querySelector(".shop-box").getAttribute("data-opts"));
      },
      methods: {
        getGoods(id) {
          if (this.loaded) return;
          this.locked = true;
          var data = {
            terms: [id],
            count: this.opts.count,
            w: this.opts.w,
            h: this.opts.h,
            open: this.opts.open,
            ratio: this.opts.ratio,
            paged: this.paged,
          };
          if (id == 0) {
            delete data.terms;
          }
          this.id = id;
          this.$https
            .post(b2_rest_url + "getShopList", Qs.stringify(data))
            .then((res) => {
              if (res.data) {
                this.$el.querySelector(".b2_gap").innerHTML = res.data;
                this.$nextTick(() => {
                  lazyLoadInstance.update();
                });
              }
              this.locked = false;
            })
            .catch((err) => {
              Qmsg["warning"](err.response.data.message, { html: true });
              this.locked = false;
            });
        },
      },
    });
  }
}
var mobileMenu = new Vue({
  el: "#mobile-menu-button",
  data: { show: false, b2token: false },
  mounted() {
    if (B2ClientWidth >= 768) return;
    this.b2token = b2token;
    this.dorpMenu();
  },
  methods: {
    dorpMenu() {
      let drop = document.querySelectorAll(".has_children .b2-arrow-down-s-line");
      if (drop.length > 0) {
        for (let index = 0; index < drop.length; index++) {
          drop[index].onclick = (event) => {
            event.stopPropagation();
            event.preventDefault();
            if (event.target.parentNode.parentNode.className.indexOf(" show") == -1) {
              this.hideAll();
              event.target.parentNode.parentNode.className += " show";
            } else {
              this.hideAll();
            }
          };
        }
      }
    },
    hideAll() {
      let sub = document.querySelectorAll(".has_children .sub-menu");
      for (let i = 0; i < sub.length; i++) {
        sub[i].parentNode.className = sub[i].parentNode.className.replace(" show", "");
      }
    },
    showMenu(val) {
      const menu = document.querySelector("#mobile-menu");
      body = document.querySelector("html");
      if (val) {
        menu.className += " show-menu-box";
        body.className += " m-open";
        this.show = true;
      } else {
        menu.className = menu.className.replace(" show-menu-box", "");
        setTimeout(() => {
          body.className = body.className.replace(" m-open", "");
        }, 300);
        this.show = false;
      }
    },
    showAc() {
      this.show = !this.show;
      this.showMenu(this.show);
    },
  },
});
Vue.component("search-box", {
  props: ["show", "searchType"],
  template: b2_global.search_box,
  data() {
    return { showSearch: false, type: "post" };
  },
  mounted() {
    const search = document.querySelector(".top-search");
    if (search) {
      const data = search.getAttribute("data-search");
      if (data) {
        let json = JSON.parse(data);
        this.type = Object.keys(json)[0];
      }
    }
  },
  methods: {
    close() {
      this.$emit("close");
    },
  },
  watch: {
    searchType(val) {
      this.type = val;
    },
  },
});
var b2SearchBox = new Vue({
  el: "#search-box",
  data: { searchType: "all", show: false },
  methods: {
    close() {
      this.show = !this.show;
    },
  },
});
var userTools = new Vue({
  el: ".top-user-info",
  data: {
    showDrop: false,
    role: {
      write: true,
      newsflashes: false,
      binding_login: false,
      create_circle: false,
      create_topic: false,
      distribution: false,
      user_data: "",
    },
    b2token: false,
  },
  computed: {
    userData() {
      return this.$store.state.userData;
    },
  },
  mounted() {
    this.b2token = b2token;
    document.onclick = (e) => {
      this.hideAction();
    };
    if (b2token) {
      let footer_text = document.querySelector("#footer-menu-user");
      if (footer_text) {
        footer_text.innerText = b2_global.js_text.global.my;
      }
      this.$http
        .post(b2_rest_url + "getUserInfo")
        .then((res) => {
          this.role = res.data;
          this.$store.commit("setUserRole", res.data);
          this.$store.commit("setUserData", res.data.user_data);
          this.$store.commit("setcanImage", res.data.can_img);
          b2AsideBar.count = res.data.carts;
          topMenuLeft.count = res.data.msg_unread;
          b2bindLogin.type = res.data.binding_login;
          payCredit.user.credit = res.data.user_data.credit;
          this.$nextTick(() => {
            b2tooltip(".user-tips");
            lazyLoadInstance.update();
          });
        })
        .catch((err) => {
          this.loginOut();
        });
    } else {
      this.$https.get(b2_rest_url + "getOauthLink").then((res) => {
        this.$store.commit("setOauthLink", res.data);
        this.$nextTick(() => {
          lazyLoadInstance.update();
        });
      });
      let ref = b2GetQueryVariable("ref");
      if (ref) {
        b2setCookie("ref", ref);
      }
    }
  },
  methods: {
    hideAction() {
      this.showDrop = false;
      if (typeof b2Comment !== "undefined") {
        b2Comment.show.smile = false;
        b2Comment.show.image = false;
      }
      if (typeof b2infomation !== "undefined") {
        b2infomation.showFliter = false;
      }
      if (typeof b2TaxTop !== "undefined") {
        b2TaxTop.showFliter.hot = false;
        b2TaxTop.showFliter.cat = false;
      }
      if (typeof topsearch !== "undefined") {
        topsearch.show = false;
      }
      if (typeof writeHead !== "undefined") {
        Qmsg.closeAll();
      }
      if (typeof b2CirclePostBox !== "undefined") {
        b2CirclePostBox.ask.focus = false;
        if (b2CirclePostBox.ask.userInput) {
          b2CirclePostBox.ask.picked = true;
        }
        b2CirclePostBox.role.show = false;
        b2CirclePostBox.smileShow = false;
      }
      if (typeof poAsk !== "undefined") {
        poAsk.ask.focus = false;
        if (poAsk.userInput) {
          poAsk.ask.picked = true;
        }
      }
      if (typeof b2CircleList !== "undefined") {
        if (!b2CircleList.$refs.topicForm) return;
        if (!b2CircleList.commentBox.content) {
          if (b2CircleList.$refs.topicForm.value == "") {
            b2CircleList.commentBox.focus = false;
          }
          b2CircleList.smileShow = false;
        }
        b2CircleList.circle.showBox = "";
        b2CircleList.topicFliter.show = false;
        b2CircleList.answer.showSmile = false;
      }
      b2AsideBar.close();
    },
    login(type) {
      login.show = true;
      login.loginType = type;
    },
    showDropMenu() {
      this.showDrop = !this.showDrop;
    },
    loginOut() {
      axios
        .get(b2_rest_url + "loginOut")
        .then((res) => {
          b2delCookie("b2_token");
          b2CurrentPageReload();
        })
        .catch((err) => {
          b2delCookie("b2_token");
          b2CurrentPageReload();
        });
    },
    out() {
      this.loginOut();
    },
    goUserPage(type) {
      if (type === "back") {
        window.location = b2getCookie("b2_back_url");
      } else if (type) {
        if (!b2token) {
          this.login(1);
          return;
        }
        window.location = this.$store.state.userData.link + "/" + type;
      } else {
        if (!b2token) {
          this.login(1);
          return;
        }
        window.location = this.$store.state.userData.link;
      }
    },
  },
});
var topMenuLeft = new Vue({
  el: ".change-theme",
  data: { theme: "light", count: 0, login: false },
  mounted() {
    if (b2token) {
      this.login = true;
    }
  },
  methods: {
    changeTheme(type) {
      this.theme = type;
    },
    showBox() {
      postPoBox.show = true;
    },
    go(type) {
      if (type === "orders") {
        if (b2token) {
          window.location.href = this.$store.state.userData.link + "/orders";
        } else {
          login.show = true;
          login.loginType = 1;
        }
      }
      if (type === "requests") {
        if (b2token) {
          window.location.href = b2_global.home_url + "/requests";
        } else {
          login.show = true;
          login.loginType = 1;
        }
      }
    },
  },
});
var headerTools = new Vue({
  el: ".header-tools",
  computed: {
    userData() {
      return this.$store.state.userData;
    },
  },
  methods: {
    showSearch() {
      b2SearchBox.close();
    },
  },
});
Vue.component("login-box", {
  props: [
    "show",
    "allowRegister",
    "checkType",
    "loginType",
    "loginText",
    "invitation",
    "invitationLink",
    "invitationText",
    "imgBoxCode",
  ],
  template: b2_global.login,
  data() {
    return {
      data: {
        nickname: "",
        username: "",
        password: "",
        code: "",
        img_code: "",
        invitation_code: "",
        token: "",
        smsToken: "",
        luoToken: "",
        confirmPassword: "",
        loginType: "",
      },
      invitationPass: false,
      eye: false,
      codeImg: "",
      locked: false,
      showLuo: false,
      issetLuo: false,
      imgLocked: false,
      SMSLocked: false,
      count: 60,
      repass: false,
      type: "",
      isWeixin: false,
    };
  },
  computed: {
    oauth() {
      return this.$store.state.oauthLink;
    },
    openOauth() {
      return this.$store.state.openOauth;
    },
  },
  created() {
    window.getResponse = (resp) => {
      if (this.type == "edit") {
        b2AuthorEdit.sendCode(resp);
        recaptcha.close();
      } else {
        this.data.img_code = resp;
        this.$nextTick(() => {
          recaptcha.close();
          this.sendSMS();
        });
      }
    };
    this.isWeixin = b2isWeixin();
  },
  methods: {
    close(val) {
      this.$emit("close-form", val);
    },
    loginAc(val) {
      this.$emit("login-ac", val);
    },
    loginSubmit(e) {
      e.preventDefault();
      if (this.locked == true) return;
      this.locked = true;
      if (this.invitation != 0 && this.loginType == 2 && !this.invitationPass) {
        this.invitationCheck();
      } else if (this.loginType == 1) {
        this.$https
          .post(b2_global.rest_url + "jwt-auth/v1/token", Qs.stringify(this.data))
          .then((res) => {
            b2CurrentPageReload();
            return;
          })
          .catch((err) => {
            Qmsg["warning"](err.response.data.message, { html: true, timeout: 10000 });
            this.locked = false;
          });
      } else if (this.loginType == 2) {
        this.$https
          .post(b2_rest_url + "regeister", Qs.stringify(this.data))
          .then((res) => {
            b2CurrentPageReload();
            return;
          })
          .catch((err) => {
            Qmsg["warning"](err.response.data.message, { html: true });
            this.locked = false;
          });
      } else if (this.loginType == 3) {
        this.$https
          .post(b2_rest_url + "forgotPass", Qs.stringify(this.data))
          .then((res) => {
            this.loginAc(4);
            this.locked = false;
          })
          .catch((err) => {
            Qmsg["warning"](err.response.data.message, { html: true });
            this.locked = false;
          });
      } else if (this.loginType == 4) {
        this.$https
          .post(b2_rest_url + "resetPass", Qs.stringify(this.data))
          .then((res) => {
            this.repass = true;
            this.data.password = "";
            this.loginAc(1);
            this.locked = false;
          })
          .catch((err) => {
            Qmsg["warning"](err.response.data.message, { html: true });
            this.locked = false;
          });
      }
    },
    b2IsPhoneAvailable(val) {
      if (b2IsPhoneAvailable(val)) return true;
      return false;
    },
    invitationCheck() {
      this.$https
        .post(b2_rest_url + "invitationCheck", "code=" + this.data.invitation_code)
        .then((res) => {
          this.invitationPass = true;
          this.locked = false;
          this.showLuo = true;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    sendCode() {
      recaptcha.show = true;
      this.close(false);
    },
    getCode() {
      if (this.imgLocked) return;
      this.codeImg = "";
      this.imgLocked = true;
      this.$https
        .post(b2_rest_url + "getRecaptcha", "number=4&width=186&height=50")
        .then((res) => {
          if (res.data) {
            this.codeImg = res.data.base;
            this.data.token = res.data.token;
          }
          this.imgLocked = false;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.imgLocked = false;
        });
    },
    changeCode() {
      this.getCode();
    },
    isEmail(email) {
      var pattern = /^([a-zA-Z0-9]+[_|\_|\.]?)*[a-zA-Z0-9]+@([a-zA-Z0-9]+[_|\_|\.]?)*[a-zA-Z0-9]+\.[a-zA-Z]{2,3}$/;
      return pattern.test(email);
    },
    checkTips() {
      let text = "";
      if (this.checkType == "tel") {
        text = b2_global.js_text.global.check_type.tel;
      }
      if (this.checkType == "email") {
        text = b2_global.js_text.global.check_type.mail;
      }
      if (this.checkType == "telandemail") {
        if (this.isEmail(this.data.username)) {
          text = b2_global.js_text.global.check_type.mail;
        } else {
          text = b2_global.js_text.global.check_type.tel;
        }
      }
      if (text) {
        Qmsg.info(b2_global.js_text.global.check_message, { showClose: true, autoClose: false });
      }
    },
    sendSMS() {
      if (this.SMSLocked) return;
      this.SMSLocked = true;
      this.data.loginType = this.loginType;
      this.$https
        .post(b2_rest_url + "sendCode", Qs.stringify(this.data))
        .then((res) => {
          if (res.data.token) {
            this.data.smsToken = res.data.token;
          }
          this.SMSLocked = false;
          this.countdown();
          this.checkTips();
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.SMSLocked = false;
        });
    },
    markHistory(mp, e) {
      if (!this.$store.state.xieyi && this.loginType == 2) {
        e.preventDefault();
        Qmsg["warning"](b2_global.js_text.global.xieyi, { html: true });
        return;
      }
      if (mp) {
        this.close();
        mpCode.show = true;
        mpCode.type = this.loginType;
      }
      b2setCookie("b2_back_url", window.location.href);
    },
    countdown() {
      if (this.count <= 1) {
        this.count = 60;
        return;
      }
      this.count--;
      setTimeout(() => {
        this.countdown();
      }, 1000);
    },
    resetPssNext() {
      this.loginAc(4);
    },
  },
  watch: {
    oauth(val) {
      if (val) {
        Object.keys(val).forEach((key) => {
          if (val[key].open) {
            this.$store.commit("setOpenOauth", true);
          }
        });
        if (b2isWeixin() && b2_global.wx_mp_in_login == 1) {
          if (!b2token && document.querySelector("#open-page") === null) {
            b2setCookie("b2_back_url", window.location.href);
            window.location.href = this.oauth.weixin.url;
          }
        }
      }
    },
    loginType(val) {
      if ((this.invitation == 0 || this.invitationPass) && val == 2) {
        this.showLuo = true;
      } else {
        this.showLuo = false;
      }
      if (this.issetLuo) {
        LUOCAPTCHA && LUOCAPTCHA.reset();
      }
    },
    invitationPass(val) {
      if (this.issetLuo && val) {
        setTimeout(() => {
          LUOCAPTCHA && LUOCAPTCHA.reset();
        }, 100);
      }
    },
    show(val) {
      if (val && this.checkType == "text") {
        this.getCode();
        this.type = "";
      }
    },
    imgBoxCode(val) {
      this.data.img_code = val.value;
      this.data.token = val.token;
    },
    showLuo(val) {
      if (this.show && this.checkType == "luo" && val && !this.issetLuo) {
        let s = document.createElement("script");
        s.id = "luosimao";
        s.type = "text/javascript";
        s.src = "//captcha.luosimao.com/static/dist/api.js";
        document.getElementsByTagName("head")[0].appendChild(s);
        this.issetLuo = true;
      }
    },
  },
});
Vue.component("mp-box", {
  props: ["show", "invitation", "invitationLink", "invitationText"],
  template: b2_global.mp_box,
  data() {
    return {
      code: "",
      locked: false,
      token: false,
      invitationCode: "",
      locked: false,
      qrcode: "",
      t: false,
      count: 100,
    };
  },
  computed: {
    oauthLink() {
      return this.$store.state.oauthLink;
    },
  },
  methods: {
    close() {
      this.$emit("close");
      this.t = null;
    },
    submit() {
      if (this.locked == true) return;
      this.locked = true;
      if (this.count <= 1 || this.t === null) {
        this.t = null;
        this.count = 100;
        return;
      }
      this.$http
        .post(b2_rest_url + "mpLogin", "code=" + this.code)
        .then((res) => {
          if (res.data === "waiting") {
            this.locked = false;
            this.t = setTimeout(() => {
              this.submit();
            }, 1000);
            return;
          }
          if (res.data.type === "invitation") {
            this.token = res.data.token;
          } else {
            if (res.data === true) {
              b2CurrentPageReload();
            } else {
              this.$store.commit("setUserData", res.data);
              Vue.prototype.$http.defaults.headers.common["Authorization"] = "Bearer " + b2token;
              b2CurrentPageReload();
            }
          }
          this.t = null;
          this.locked = false;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    checkInv() {
      if (this.locked == true) return;
      this.locked = true;
      this.$https
        .post(b2_rest_url + "mpLoginInv", "token=" + this.token + "&inv=" + this.invitationCode)
        .then((res) => {
          if (res.data.token) {
            b2CurrentPageReload();
          }
          this.locked = false;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    getQrcode() {
      this.$https
        .post(b2_rest_url + "getLoginQrcode")
        .then((res) => {
          this.code = res.data.sence_id;
          this.qrcode = res.data.qrcode;
          this.submit();
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
        });
    },
  },
  watch: {
    show(val) {
      if (val) {
        if (this.oauthLink.weixin.pc_open) {
          b2loadScript("https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js", "", () => {
            new WxLogin({
              self_redirect: false,
              id: "mp-login-box",
              appid: b2_global.wx_appid,
              scope: "snsapi_login",
              redirect_uri: b2_global.home_url + "/open?type=weixin",
              state: "",
              style: "black",
              href: "data:text/css;base64,LmltcG93ZXJCb3ggLnFyY29kZSB7DQogICAgd2lkdGg6IDEwMCU7DQogICAgbWFyZ2luLXRvcDogMDsNCiAgICBib3JkZXI6IDA7DQp9DQouaW1wb3dlckJveCAuaW5mbyB7DQogICAgZGlzcGxheTogbm9uZTsNCn0NCi5pbXBvd2VyQm94IC50aXRsZXsNCmRpc3BsYXk6bm9uZQ0KfQ==",
            });
          });
        } else {
          this.locked = false;
          this.t = false;
          this.count = 100;
          this.getQrcode();
        }
      }
    },
  },
});
var mpCode = new Vue({
  el: "#mp-box",
  data: { show: false, qrcode: "", type: "1" },
  methods: {
    close() {
      this.show = !this.show;
      if (!b2token) {
        login.show = true;
        login.loginType = this.type;
      }
    },
  },
});
var login = new Vue({
  el: "#login-box",
  data: { show: false, loginType: 1, checkCodeSendSuccess: false, isAdmin: false, imgCode: "" },
  methods: {
    close(val) {
      this.show = val;
    },
    loginAc(val) {
      this.loginType = val;
    },
    imgCodeAc(val) {
      this.imgCode = val;
    },
  },
});
Vue.component("recaptcha-box", {
  props: ["show", "type"],
  template: b2_global.check_code,
  data() {
    return {
      recaptcha: "",
      token: "",
      recaptchaUrl: "",
      disabled: true,
      issetLuo: false,
      locked: false,
      loginType: 2,
      checkType: b2_global.check_type,
    };
  },
  methods: {
    close() {
      this.$emit("close-form");
    },
    change() {
      if (this.locked) return;
      this.recaptchaUrl = "";
      this.locked = true;
      this.$https
        .post(b2_rest_url + "getRecaptcha", "number=4&width=186&height=50")
        .then((res) => {
          if (res.data) {
            this.recaptchaUrl = res.data.base;
            this.token = res.data.token;
          }
          this.locked = false;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    checkCode() {
      if (this.disabled) return;
      this.disabled = true;
      this.$https
        .post(
          b2_rest_url + "imgCodeCheck",
          "img_code=" + this.recaptcha + "&token=" + this.token + "&loginType=" + login.loginType,
        )
        .then((res) => {
          if (this.type == "edit") {
            b2AuthorEdit.imgCodeAc({ value: this.recaptcha, token: this.token });
          } else if (this.type == "bind") {
            b2bindLogin.imgCodeAc({ value: this.recaptcha, token: this.token });
          } else {
            login.imgCodeAc({ value: this.recaptcha, token: this.token });
            setTimeout(() => {
              login.$refs.loginBox.sendSMS();
            }, 50);
          }
          this.disabled = false;
          this.close();
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.disabled = false;
        });
    },
  },
  watch: {
    show(val) {
      if (val && b2_global.check_type == "normal") {
        this.change();
      }
      if (val && !this.issetLuo && login.loginType != 3) {
        let s = document.createElement("script");
        s.id = "luosimao";
        s.type = "text/javascript";
        s.src = "//captcha.luosimao.com/static/dist/api.js?time=" + new Date().getTime();
        document.getElementsByTagName("head")[0].appendChild(s);
        this.issetLuo = true;
      } else if (val && this.issetLuo && login.loginType != 3) {
        LUOCAPTCHA && LUOCAPTCHA.reset();
      }
      if (this.type != "edit") {
        this.loginType = login.loginType;
      }
    },
    recaptcha(val) {
      if (val.length == 4) {
        this.disabled = false;
      } else {
        this.disabled = true;
      }
    },
  },
});
var recaptcha = new Vue({
  el: "#recaptcha-form",
  data: { show: false, type: "" },
  methods: {
    close() {
      this.show = false;
      if (this.type != "edit" && this.type != "bind") {
        login.show = true;
      }
      if (this.type === "bind") {
        b2bindLogin.show = true;
      }
    },
  },
});
function indexPostModules() {
  let m = document.querySelectorAll(".post-list");
  if (m.length > 0) {
    for (let i = 0; i < m.length; i++) {
      let key = m[i].getAttribute("data-key");
      if (m[i].id != "undefined") {
        new Vue({
          el: "#post-item-" + key,
          data: {
            key: 0,
            index: 0,
            box: "",
            paged: 1,
            pages: 0,
            type: "cat",
            showButton: false,
            locked: false,
            cat: [],
            finish: false,
            id: 0,
          },
          mounted() {
            if (this.$el.querySelector(".load-more")) {
              this.key = key;
              this.index = this.$el.getAttribute("data-i");
              this.box = this.$el.querySelectorAll(".b2_gap")[0];
              this.showButton = this.$el.querySelector(".load-more").getAttribute("data-showButton");
            }
          },
          methods: {
            getList(id, type, postType) {
              if (this.finish && type == "more") {
                return;
              } else {
                this.finish = false;
              }
              if (this.locked) return;
              this.locked = true;
              this.id = id;
              if (type) {
                this.type = type;
              }
              if (this.type == "cat") {
                this.paged = 1;
                if (id) {
                  this.cat = [id];
                } else {
                  this.cat = [];
                }
                this.finish = false;
              } else {
                this.paged = this.paged + 1;
              }
              let data = { index: this.index, id: this.cat, post_paged: this.paged };
              axios.post(b2_rest_url + "getModulePostList", Qs.stringify(data)).then((res) => {
                if (res.data.count > 0) {
                  this.pages = res.data.pages;
                  if (this.type == "cat") {
                    if (this.pages == 1) {
                      this.box.innerHTML = res.data.data;
                    } else {
                      this.box.innerHTML = res.data.data;
                    }
                    if (postType == "post-2") {
                      b2PackeryLoad();
                    }
                    this.showButton = true;
                  } else if (this.type == "more") {
                    this.box.insertAdjacentHTML("beforeend", res.data.data);
                    if (postType == "post-2") {
                      b2PackeryLoad();
                    }
                    this.showButton = true;
                  }
                  if (this.paged >= this.pages) {
                    this.finish = true;
                  }
                } else {
                  if (postType == "post-6") {
                    this.box.innerHTML = '<tr><td colspan="10" style="border:0">' + b2_global.empty_page + "</td></tr>";
                  } else {
                    this.box.innerHTML = b2_global.empty_page;
                  }
                  this.showButton = false;
                }
                this.locked = false;
                b2SidebarSticky();
                this.$nextTick(() => {
                  lazyLoadInstance.update();
                });
              });
            },
          },
        });
      }
    }
  }
}
indexPostModules();
function listFadein(dom, time) {
  return;
  var i = 0;
  dom.forEach((e) => {
    if (e.className.indexOf("is-visible") === -1) {
      i++;
      if (i == 1) {
        e.className += " is-visible";
      } else {
        setTimeout(function () {
          e.className += " is-visible";
        }, i * time);
      }
    }
  });
}
listFadein(document.querySelectorAll(".post-list ul.b2_gap > li"), 10);
function b2PackeryLoad(e) {
  var grid = document.querySelectorAll(".grid");
  if (grid.length > 0) {
    for (let index = 0; index < grid.length; index++) {
      let pack = new Packery(grid[index]);
      pack.on("layoutComplete", () => {
        b2SidebarSticky();
      });
    }
  }
}
b2PackeryLoad();
Vue.component("pagenav-new", {
  props: ["type", "paged", "pages", "opt", "api", "rote"],
  template: b2_global.page_nav,
  data: function () {
    return { locked: false, next: false, per: false, cpage: 0, cpaged: 1, cpages: [], mobile: false, showGo: false };
  },
  created() {
    window.addEventListener("scroll", _debounce(this.autoLoadMore), passiveSupported ? { passive: true } : false);
    this.cpaged = parseInt(this.paged);
    this.cpages = this.pagesInit();
    window.addEventListener(
      "popstate",
      () => {
        let state = history.state;
        if (state && state.page && this.type == "p") {
          this.go(state.page);
        }
      },
      passiveSupported ? { passive: true } : false,
    );
    this.mobile = B2ClientWidth > 768 ? false : true;
  },
  methods: {
    disabled(page) {
      return page == this.cpaged && this.locked == true;
    },
    pagesInit() {
      let pagearr = [];
      if (this.pages <= 6) {
        for (let i = 1; i <= this.pages; i++) {
          pagearr.push(i);
        }
      } else {
        if (!this.cpaged) this.cpaged = this.paged;
        if (this.cpaged < 4) {
          for (let i = 1; i <= this.pages; i++) {
            if (i >= 5) break;
            pagearr.push(i);
          }
          pagearr.push(0, this.pages);
        } else if (this.cpaged >= 4 && this.pages - 2 > this.cpaged) {
          pagearr.push(1, 0);
          for (let i = this.cpaged - 1; i <= this.cpaged + 1; i++) {
            pagearr.push(i);
          }
          pagearr.push(0, this.pages);
        } else if (this.pages - 2 <= this.cpaged) {
          pagearr.push(1, 0);
          for (let i = this.cpaged - 2; i <= this.pages; i++) {
            pagearr.push(i);
          }
        }
      }
      return pagearr;
    },
    focus() {
      this.showGo = true;
    },
    blur() {
      setTimeout(() => {
        this.showGo = false;
      }, 100);
    },
    autoLoadMore() {
      if (this.type == "p") return;
      if (this.cpaged == this.pages) return;
      let scrollTop = document.documentElement.scrollTop;
      if (scrollTop + window.innerHeight >= document.body.clientHeight - 550) {
        this.go(this.cpaged + 1);
      }
    },
    trimSlashes(str) {
      return str.replace(/\/+$/, "");
    },
    go(page, type, action) {
      page = parseInt(page);
      if (this.opt.length > 0) return;
      if (this.cpaged == page && !action) return;
      if (this.locked == true) return;
      this.locked = true;
      if (this.type === "m" && this.pages <= this.cpaged && page != 1) return;
      if (type == "next") {
        this.next = true;
        this.per = false;
      } else if (type == "per") {
        this.per = true;
        this.next = false;
      }
      this.cpaged = page;
      this.opt["post_paged"] = page;
      this.opt["paged"] = page;
      this.$http
        .post(b2_rest_url + this.api, Qs.stringify(this.opt))
        .then((res) => {
          this.locked = false;
          this.cpages = this.pagesInit();
          this.$emit("return", res.data);
          if (this.rote) {
            let currentURL = window.location.href,
              url = this.trimSlashes(currentURL.split("?")[0]),
              newURL;
            console.log(url);
            if (this.cpaged == 1) {
              newURL = url.replace(/\/page\/\d/, "");
            } else {
              if (currentURL.indexOf("/page/") == -1) {
                newURL = url + "/page/" + this.cpaged;
              } else {
                newURL = url.replace(/\/page\/[0-9]*$/, "/page/" + page);
              }
            }
            url = currentURL.replace(url, newURL);
            window.history.pushState({ page: page }, null, url);
            if (this.type === "p") {
              b2AsideBar.goTop();
            }
          }
          b2SidebarSticky();
          this.$nextTick(() => {
            lazyLoadInstance.update();
          });
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
        });
    },
    getData(fn, data) {
      this.cpaged = this.cpage;
      this.cpages = this.pagesInit();
    },
    jump(event) {
      var val = event.target.value || event.target.previousElementSibling.value || this.$refs.pagenavnumber.value;
      val = parseInt(val);
      if (val > this.pages) return;
      this.go(val, "p", true);
    },
  },
  watch: {
    pages(val) {
      this.cpages = this.pagesInit();
    },
    paged() {
      this.cpaged = parseInt(this.paged);
      this.cpages = this.pagesInit();
    },
  },
});
Vue.component("page-nav", {
  props: ["paged", "navtype", "pages", "type", "box", "opt", "api", "url", "title"],
  template: b2_global.page_nav,
  data: function () {
    return { locked: false, next: false, per: false, cpage: 0, cpaged: 1, cpages: [], mobile: false, showGo: false };
  },
  created() {
    window.addEventListener("scroll", _debounce(this.autoLoadMore), passiveSupported ? { passive: true } : false);
    this.cpaged = parseInt(this.paged);
    this.cpages = this.pagesInit();
    window.addEventListener(
      "popstate",
      () => {
        let state = history.state;
        if (state && state.page && this.type == "p") {
          this.go(state.page);
        }
      },
      passiveSupported ? { passive: true } : false,
    );
    this.mobile = B2ClientWidth > 768 ? false : true;
  },
  methods: {
    disabled(page) {
      return page == this.cpaged && this.locked == true;
    },
    pagesInit() {
      let pagearr = [];
      if (this.pages <= 7) {
        for (let i = 1; i <= this.pages; i++) {
          pagearr.push(i);
        }
      } else {
        if (!this.cpaged) this.cpaged = this.paged;
        if (this.cpaged < 5) {
          for (let i = 1; i <= this.pages; i++) {
            if (i >= 6) break;
            pagearr.push(i);
          }
          pagearr.push(0, this.pages);
        } else if (this.cpaged >= 5 && this.pages - 3 > this.cpaged) {
          pagearr.push(1, 0);
          for (let i = this.cpaged - 2; i <= this.cpaged + 2; i++) {
            pagearr.push(i);
          }
          pagearr.push(0, this.pages);
        } else if (this.pages - 3 <= this.cpaged) {
          pagearr.push(1, 0);
          for (let i = this.cpaged - 3; i <= this.pages; i++) {
            pagearr.push(i);
          }
        }
      }
      return pagearr;
    },
    autoLoadMore() {
      setTimeout(() => {
        if (this.type == "p") return;
        let scrollTop = document.documentElement.scrollTop;
        if (scrollTop + window.innerHeight >= document.body.clientHeight - 550) {
          this.go(this.cpaged + 1);
        }
      }, 300);
    },
    focus() {
      this.showGo = true;
    },
    blur() {
      setTimeout(() => {
        this.showGo = false;
      }, 100);
    },
    go(page, type, action) {
      page = parseInt(page);
      if (this.opt.length > 0) return;
      if (this.cpaged == page && !action) return;
      if (this.locked == true) return;
      if (this.type === "m" && this.pages <= this.cpaged && page != 1) return;
      this.locked = true;
      if (type == "next") {
        this.next = true;
        this.per = false;
      } else if (type == "per") {
        this.per = true;
        this.next = false;
      }
      this.cpaged = page;
      console.log(this.cpaged);
      this.opt["post_paged"] = page;
      this.opt["paged"] = page;
      this.$http
        .post(b2_rest_url + this.api, Qs.stringify(this.opt))
        .then((res) => {
          this.locked = false;
          this.cpages = this.pagesInit();
          let dom = document.querySelector(this.box);
          if (this.navtype === "json") {
            this.$emit("return", res.data);
          } else {
            if (this.type === "p") {
              dom.innerHTML = res.data.data;
            } else {
              dom.insertAdjacentHTML("beforeend", res.data.data);
            }
          }
          if (page != 1) {
            this.url = b2removeURLParameter(this.url, "action");
          }
          if (!!(window.history && history.pushState)) {
            if (page != 1) {
              if (this.navtype === "comment") {
                if (b2_global.structure) {
                  window.history.pushState({ page: page }, null, this.url + "/comment-page-" + page + "#comment");
                } else {
                  window.history.pushState({ page: page }, null, this.url + "&cpage=" + page + "#comment");
                }
              } else {
                if (this.navtype != "authorComments" && this.title) {
                  document.title =
                    this.title +
                    " " +
                    b2_global.site_separator +
                    " " +
                    b2_global.page_title.replace("{#}", page) +
                    " " +
                    b2_global.site_separator +
                    " " +
                    b2_global.site_name;
                }
                let currentURL = window.location.href,
                  url = currentURL.split("?")[0],
                  newURL;
                if (this.cpaged == 1) {
                  newURL = url.replace(/\/page\/\d/, "");
                } else {
                  if (currentURL.indexOf("/page/") == -1) {
                    newURL = url + "/page/" + this.cpaged;
                  } else {
                    newURL = url.replace(/\/page\/[0-9]*$/, "/page/" + page);
                  }
                }
                url = currentURL.replace(url, newURL);
                window.history.pushState({ page: page }, null, url);
                if (this.type === "p") {
                  b2AsideBar.goTop();
                }
              }
            } else {
              if (this.navtype === "comment") {
                window.history.pushState({ page: page }, null, this.url + "#comment");
              } else {
                if (this.navtype != "authorComments" && this.title) {
                  document.title = this.title + " " + b2_global.site_separator + " " + b2_global.site_name;
                }
                window.history.pushState({ page: page }, null, this.url);
              }
            }
          }
          if (this.navtype === "comment" || this.navtype === "authorComments") {
            let img = document.querySelectorAll(".comment-img-box img");
            if (img.length > 0) {
              for (let index = 0; index < img.length; index++) {
                b2zoom.listen(img[index]);
              }
            }
            if (this.navtype === "comment") {
              b2CommentList.showSticky();
              b2SidebarSticky();
            }
          } else if (this.navtype === "post") {
            b2PackeryLoad();
            setTimeout(() => {
              listFadein(document.querySelectorAll(this.box + " > li"), 20);
            }, 500);
          }
          this.$emit("finish");
          b2SidebarSticky();
          this.$nextTick(() => {
            lazyLoadInstance.update();
          });
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
        });
    },
    getData(fn, data) {
      this.cpaged = this.cpage;
      this.cpages = this.pagesInit();
    },
    jump(event) {
      var val = event.target.value || event.target.previousElementSibling.value || this.$refs.pagenavnumber.value;
      val = parseInt(val);
      if (val > this.pages) return;
      this.go(val, "p", true);
    },
  },
  watch: {
    pages(val) {
      this.cpages = this.pagesInit();
    },
    paged() {
      this.cpaged = parseInt(this.paged);
      this.cpages = this.pagesInit();
    },
  },
});
function b2RestTimeAgo(dom) {
  if (dom && dom.length > 0) timeago.render(dom, b2_global.language);
}
let pageNavBox = new Vue({
  el: ".post-nav",
  data: { selecter: "#post-list .b2_gap", opt: "", api: "getPostList", options: [], value: 1, showGoN: false },
  mounted() {
    if (typeof b2_cat !== "undefined") {
      this.opt = b2_cat.opt;
    }
  },
  methods: {
    jumpAc: function (event) {
      var val = event.target.value || event.target.previousElementSibling.value || this.$refs.pagenavnumber.value;
      if (val > this.opt.pages) return;
      let currentURL = window.location.href,
        url = currentURL.split("?")[0],
        newURL;
      if (val == 1) {
        newURL = url.replace(/\/page\/\d/, "");
      } else {
        if (currentURL.indexOf("/page/") == -1) {
          newURL = url + "/page/" + val;
        } else {
          newURL = url.replace(/\/page\/[0-9]*$/, "/page/" + val);
        }
      }
      url = currentURL.replace(url, newURL);
      window.location.href = url;
    },
    focus() {
      this.showGoN = true;
    },
    blur() {
      setTimeout(() => {
        this.showGoN = false;
      }, 100);
    },
  },
});
let b2Audio = new Vue({
  el: ".b2-audio-content",
  data: {
    url: "",
    textList: [],
    playStatus: false,
    api: "https://tts.baidu.com/text2audio?cuid=baike&lan=ZH&ctp=1&pdt=301&tex=",
    index: 0,
    currentTime: "00:00",
    startTime: "00:00",
    step: 0,
    duration: 0,
    ds: "",
    width: "0%",
  },
  methods: {
    play() {
      if (!this.url) {
        this.getPlayList();
      } else {
        this.playList();
      }
    },
    getPlayList() {
      this.$https
        .post(b2_rest_url + "getPostAudio", "post_id=" + this.$refs.audio.getAttribute("data-id"))
        .then((res) => {
          if (res.data.length > 0) {
            this.textList = res.data;
            this.playList();
            this.watchPlay();
          }
        });
    },
    playList() {
      this.url = this.api + this.textList[this.index];
      setTimeout(() => {
        this.button();
      });
    },
    watchPlay() {
      this.$refs.audio.addEventListener(
        "ended",
        () => {
          if (this.index >= this.textList.length - 1) {
            this.playStatus = false;
            this.index = 0;
            this.step = 0;
            return;
          }
          this.step = 0;
          this.index = this.index + 1;
          this.playList();
        },
        passiveSupported ? { passive: true } : false,
      );
    },
    button() {
      if (this.$refs.audio !== null) {
        if (this.$refs.audio.paused) {
          this.$refs.audio.play();
          this.playStatus = true;
          this.timeSetp();
        } else {
          this.$refs.audio.pause();
          this.playStatus = false;
        }
        this.$refs.audio.addEventListener(
          "loadedmetadata",
          () => {
            this.duration = Math.round(this.$refs.audio.duration);
            this.currentTime = this.secondToDate(this.duration);
          },
          passiveSupported ? { passive: true } : false,
        );
      }
    },
    timeSetp() {
      if (this.playStatus == true) {
        this.startTime = this.secondToDate(this.step++);
        if (this.ds) {
          clearTimeout(this.ds);
        }
        this.ds = setTimeout(() => {
          this.timeSetp();
          this.width = (this.step / this.duration) * 100 + "%";
        }, 1000);
      }
    },
    secondToDate(s) {
      var t;
      if (s > -1) {
        var hour = Math.floor(s / 3600);
        var min = Math.floor(s / 60) % 60;
        var sec = s % 60;
        if (hour > 1) {
          if (hour < 10) {
            t = "0" + hour + ":";
          } else {
            t = hour + ":";
          }
        } else {
          t = "";
        }
        if (min < 10) {
          t += "0";
        }
        t += min + ":";
        if (sec < 10) {
          t += "0";
        }
        t += sec.toFixed(0);
      }
      return t;
    },
  },
});
var socialLogin = new Vue({
  el: "#juhe-social",
  data: { locked: false, error: "" },
  mounted() {
    if (!this.$refs.juhebox) return;
    let type = b2GetQueryVariable("type");
    this.locked = true;
    this.$http
      .post(b2_rest_url + "juheSocialLogin", "type=" + type)
      .then((res) => {
        window.location.href = res.data;
      })
      .catch((err) => {
        this.error = err.response.data.message;
        this.locked = false;
      });
  },
  methods: {
    back() {
      let url = b2getCookie("b2_back_url");
      if (url) {
        window.location.href = url;
      } else {
        window.location.href = b2_global.home_url;
      }
    },
  },
});
var socialBox = new Vue({
  el: "#social-box",
  data: { locked: false, type: "", data: { token: "", invitation: "", subType: "" }, error: "", oauth: "", name: "" },
  mounted() {
    if (this.$refs.socialBox) {
      let code = b2GetQueryVariable("code"),
        juhe = b2GetQueryVariable("juhe") ? b2GetQueryVariable("juhe") : 0;
      this.type = b2GetQueryVariable("type");
      if (code) {
        this.locked = true;
        this.$http
          .post(b2_rest_url + "socialLogin", "code=" + code + "&type=" + this.type + "&juhe=" + juhe)
          .then((res) => {
            this.locked = false;
            if (res.data === true) {
              this.back();
            } else if (res.data.type == "invitation") {
              ((this.type = "invitation"), (this.data.token = res.data.token));
            } else {
              this.back();
            }
          })
          .catch((err) => {
            if (err.response.data.message.msg) {
              this.oauth = err.response.data.message.oauth;
              this.error = err.response.data.message.msg;
              this.name = err.response.data.message.name;
            } else {
              this.error = err.response.data.message;
            }
            this.locked = false;
          });
      }
    }
  },
  methods: {
    back() {
      let url = b2getCookie("b2_back_url");
      if (url) {
        window.location.href = url;
      } else {
        window.location.href = b2_global.home_url;
      }
    },
    invRegeister(type) {
      if (this.locked == "pass" || this.locked == "sub") return;
      this.locked = type;
      this.data.subType = type;
      this.$http
        .post(b2_rest_url + "invRegeister", Qs.stringify(this.data))
        .then((res) => {
          this.back();
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    loginOut(url) {
      b2delCookie("b2_token");
      b2CurrentPageReload(url);
    },
    rebuild(ev) {
      this.$http
        .post(b2_rest_url + "unBuild", "type=" + this.type + "&user_id=" + b2_author.author_id)
        .then((res) => {})
        .catch((err) => {
          ev.preventDefault();
          Qmsg["warning"](err.response.data.message, { html: true });
        });
    },
  },
});
Vue.component("gg-box", {
  props: ["show"],
  template: b2_global.gg_box,
  computed: {
    ggdata() {
      return this.$store.state.announcement[0];
    },
  },
  methods: {
    close() {
      this.$emit("close");
    },
  },
});
var b2GG = new Vue({
  el: "#gg-box",
  data: { show: false },
  mounted() {
    this.$http.post(b2_rest_url + "getLatestAnnouncement", "count=3").then((res) => {
      if (res.data.length > 0) {
        this.$store.commit("setAnnouncement", res.data);
        this.show = res.data[0].show;
      } else {
        this.$store.commit("setAnnouncement", "none");
      }
    });
  },
  methods: {
    close() {
      this.show = false;
      let timestamp = new Date().getTime();
      timestamp = parseInt(timestamp / 1000);
      b2setCookie("gg_info", timestamp);
    },
  },
});
Vue.component("dmsg-box", {
  props: ["show", "userid", "type"],
  template: b2_global.dmsg_box,
  data() {
    return { user: [], content: "", locked: false, nickname: "", UserList: [], search: false };
  },
  methods: {
    close() {
      this.$emit("close");
      setTimeout(() => {
        this.user = [];
        this.content = "";
        this.nickname = "";
        this.UserList = [];
      }, 100);
    },
    getUserData(id = 0) {
      id = !id ? this.userid : id;
      this.$http
        .post(b2_rest_url + "getUserPublicData", "user_id=" + id)
        .then((res) => {
          this.user = res.data;
          b2Dmsg.userid = id;
          b2Dmsg.select = "";
          this.UserList = [];
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
        });
    },
    edit() {
      b2Dmsg.select = "select";
    },
    send() {
      if (this.locked == true) return;
      this.locked = true;
      this.$http
        .post(b2_rest_url + "sendDirectmessage", "user_id=" + this.userid + "&content=" + this.content)
        .then((res) => {
          if (res.data == true) {
            this.close();
          }
          if (b2DmsgPage.$refs.dmsgPage) {
            b2DmsgPage.getList();
          }
          this.locked = false;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    searchUser(val) {
      if (this.locked == true) return;
      this.locked = true;
      this.search = true;
      this.$http
        .post(b2_rest_url + "searchUsers", "nickname=" + val)
        .then((res) => {
          if (res.data.length > 0) {
            this.UserList = res.data;
          } else {
            this.UserList = [];
          }
          this.locked = false;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
          this.UserList = [];
        });
    },
  },
  watch: {
    show(val) {
      if (val && this.type !== "select") {
        this.getUserData();
      }
    },
    nickname(val) {
      if (val) {
        this.searchUser(val);
      }
    },
  },
});
var b2Dmsg = new Vue({
  el: "#dmsg-box",
  data: { userid: 0, show: false, select: "" },
  methods: {
    close() {
      this.show = !this.show;
    },
  },
});
var b2DmsgPage = new Vue({
  el: ".dmsg-page",
  data: {
    list: false,
    locked: false,
    count: 0,
    pages: 0,
    selecter: ".dmsg-header",
    opt: { paged: 1 },
    api: "getUserDirectmessageList",
  },
  mounted() {
    if (this.$refs.dmsgPage) {
      this.opt.paged = this.$refs.dmsgPage.getAttribute("data-paged");
      this.getList();
    }
  },
  methods: {
    getList() {
      this.$http
        .post(b2_rest_url + "getUserDirectmessageList", Qs.stringify(this.opt))
        .then((res) => {
          this.list = res.data.data;
          this.pages = res.data.count;
          this.locked = false;
          this.$nextTick(() => {
            b2RestTimeAgo(this.$el.querySelectorAll(".b2timeago"));
          });
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    showDmsgBox() {
      b2Dmsg.select = "select";
      b2Dmsg.show = true;
    },
    get(data) {
      this.list = data.data;
      this.pages = data.count;
      this.$nextTick(() => {
        b2RestTimeAgo(this.$el.querySelectorAll(".b2timeago"));
      });
    },
    jump(id) {
      window.location.href = this.$refs.dmsgPage.getAttribute("data-url") + "/to/" + id;
    },
    deleteDmsg(id) {},
  },
});
var b2dmsgPageTo = new Vue({
  el: ".dmsg-page-to",
  data: {
    list: false,
    locked: false,
    opt: { paged: 1, userid: 0 },
    count: 0,
    pages: 0,
    selecter: ".dmsg-header",
    api: "getMyDirectmessageList",
    content: "",
    sendLocked: false,
  },
  mounted() {
    if (this.$refs.mydmsg) {
      this.opt.userid = this.$refs.mydmsg.getAttribute("data-id");
      this.opt.paged = this.$refs.mydmsg.getAttribute("data-paged");
      this.getList();
    }
  },
  methods: {
    getList() {
      this.$http
        .post(b2_rest_url + "getMyDirectmessageList", Qs.stringify(this.opt))
        .then((res) => {
          this.list = res.data.data;
          this.locked = false;
          this.count = res.data.count;
          this.pages = res.data.pages;
          this.$nextTick(() => {
            b2RestTimeAgo(this.$el.querySelectorAll(".b2timeago"));
          });
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    get(val) {
      this.list = val.data;
      this.count = val.count;
      this.pages = val.pages;
    },
    send() {
      if (this.sendLocked == true) return;
      this.sendLocked = true;
      this.$http
        .post(b2_rest_url + "sendDirectmessage", "user_id=" + this.opt.userid + "&content=" + this.content)
        .then((res) => {
          this.getList();
          this.content = "";
          this.sendLocked = false;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.sendLocked = false;
        });
    },
  },
});
var b2DownloadPage = new Vue({
  el: "#download-page",
  data: { data: "", postId: 0, index: 0, i: 0 },
  mounted() {
    if (this.$refs.downloadPage) {
      this.postId = b2GetQueryVariable("post_id");
      this.index = b2GetQueryVariable("index");
      this.i = b2GetQueryVariable("i");
      this.getData();
      var clipboard = new ClipboardJS(".fuzhi");
      clipboard.on("success", (e) => {
        Qmsg["success"](b2_global.js_text.global.copy_success, { html: true });
      });
      clipboard.on("error", (e) => {
        Qmsg["warning"](b2_global.js_text.global.copy_select, { html: true });
      });
    }
  },
  methods: {
    getData() {
      let guest = b2getCookie("b2_guest_buy_" + this.postId + "_x");
      if (guest) {
        guest = JSON.parse(guest);
      }
      let data = { post_id: this.postId, index: this.index, i: this.i, guest: guest };
      this.$http
        .post(b2_rest_url + "getDownloadPageData", Qs.stringify(data))
        .then((res) => {
          this.data = res.data;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
        });
    },
    login() {
      login.show = true;
    },
  },
});
Vue.component("check-box", {
  props: ["show", "title", "type", "payt"],
  template: b2_global.pay_check,
  data() {
    return { success: false, timeOut: 300, timesec: "", sTime: "", check: false, checkTime: "", orderType: "" };
  },
  methods: {
    close() {
      this.$emit("close");
      this.sTime = "";
      this.checkTime = "";
    },
    checkAc() {
      if ((this.sTime === null && this.success == "fail") || this.checkTime === null || this.success === true) {
        this.checkTime = null;
        return;
      }
      let value = b2getCookie("order_id");
      this.$http.post(b2_rest_url + "payCheck", "order_id=" + value).then((res) => {
        if (res.data.status === "success") {
          this.orderType = res.data.type;
          if (!b2token) {
            let list = b2getCookie("b2_guest_buy_" + res.data.id + "_" + res.data.type);
            if (!list) {
              list = new Object();
            } else {
              list = JSON.parse(list);
            }
            Reflect.set(list, res.data.index, {
              id: res.data.id,
              order_id: value,
              type: res.data.type,
              index: res.data.index,
            });
            list = JSON.stringify(list);
            b2setCookie("b2_guest_buy_" + res.data.id + "_" + res.data.type, list);
          }
          if (typeof B2VerifyPage !== "undefined") {
            B2VerifyPage.data.money = true;
            this.close();
          } else if (typeof carts !== "undefined") {
            carts.step = 3;
            this.close();
          } else if (this.payt === "ask") {
            b2CircleList.afterCommentGetData(
              b2CircleList.answer.listParent,
              b2CircleList.data[b2CircleList.answer.listParent].topic_id,
              "ask",
            );
            this.close();
          } else if (this.payt === "hidden") {
            b2CircleList.afterCommentGetData(
              b2CircleList.hiddenIndex,
              b2CircleList.data[b2CircleList.hiddenIndex].topic_id,
              "hidden",
            );
            this.close();
          }
          this.success = true;
          this.checkTime = null;
          this.sTime = null;
        } else {
          this.checkTime = setTimeout(() => {
            this.checkAc();
          }, 1000);
        }
      });
    },
    time() {
      this.currTime = parseInt(Date.parse(new Date()) / 1000);
      this.endTime = parseInt(this.currTime + this.timeOut);
      this.setTime();
    },
    setTime() {
      if (this.show == false || this.success === true) {
        this.sTime = null;
        this.checkTime = null;
        return;
      }
      let diff_time = parseInt(this.endTime - this.currTime);
      let m = Math.floor((diff_time / 60) % 60);
      let s = Math.floor(diff_time % 60);
      this.timesec =
        (m > 0 ? m + "<b>" + b2_global.js_text.global.min + "</b>" : "") +
        s +
        "<b>" +
        b2_global.js_text.global.sec +
        "</b>";
      if (diff_time > 0) {
        this.sTime = setTimeout(() => {
          this.endTime = this.endTime - 1;
          this.setTime();
        }, 1000);
      } else {
        this.sTime = null;
        this.success = "fail";
      }
    },
    refresh() {
      if (typeof B2VerifyPage !== "undefined") {
        B2VerifyPage.data.money = true;
        this.close();
      } else if (typeof carts !== "undefined") {
        carts.step = 3;
        this.close();
      } else if (this.payt === "ask") {
        b2CircleList.afterCommentGetData(
          b2CircleList.answer.listParent,
          b2CircleList.data[b2CircleList.answer.listParent].topic_id,
          "ask",
        );
        this.close();
      } else if (this.payt === "hidden") {
        b2CircleList.afterCommentGetData(
          b2CircleList.hiddenIndex,
          b2CircleList.data[b2CircleList.hiddenIndex].topic_id,
          "hidden",
        );
        this.close();
      } else if (typeof b2poinfomation !== "undefined" && b2poinfomation.$refs.poinfomation) {
        b2poinfomation.getPoinfomationOpts();
        this.close();
      } else if (this.orderType === "x") {
        b2DownloadBox.getList();
        this.close();
      } else {
        var url = new URL(window.location.href);
        url.searchParams.delete("b2paystatus");
        window.location.href = url.href;
        b2CurrentPageReload();
      }
    },
  },
  watch: {
    show(val) {
      if (this.type == "card") return;
      if (val) {
        this.sTime = "";
        this.checkTime = "";
        this.time();
        this.checkAc();
      } else {
        this.sTime = null;
        this.success = false;
        this.checkTime = null;
      }
    },
  },
});
var b2PayCheck = new Vue({
  el: "#pay-check",
  data: { show: false, title: "", type: "", payType: "" },
  mounted() {
    if (b2GetQueryVariable("b2paystatus") == "check") {
      this.show = true;
    }
  },
  methods: {
    close() {
      this.show = !this.show;
      if (!this.show) {
        this.payType = "";
      }
    },
  },
});
var b2Pay = new Vue({
  el: "#pay-page",
  data: { data: [], token: "", error: "", locked: false, payUrl: "" },
  mounted() {
    if (this.$refs.payPage) {
      this.token = this.$refs.payPage.getAttribute("data-token");
      if (!this.token) {
        this.data = JSON.parse(this.$refs.payPage.getAttribute("data-pay"));
        this.pay();
      }
    }
  },
  methods: {
    pay() {
      if (this.locked == true) return;
      this.locked = true;
      this.$http
        .post(b2_rest_url + "buildOrder", Qs.stringify(this.data))
        .then((res) => {
          this.token = res.data;
          this.payUrl = window.location.href.split("?")[0] + "?token=" + this.token;
          this.locked = false;
        })
        .catch((err) => {
          this.error = err.response.data.message;
          this.locked = false;
        });
    },
  },
});
function b2MakeForm(url, token) {
  var form1 = document.createElement("form");
  form1.id = "form1";
  form1.name = "form1";
  document.body.appendChild(form1);
  var input = document.createElement("input");
  input.name = "token";
  input.value = token;
  form1.appendChild(input);
  form1.method = "POST";
  form1.action = url;
  form1.submit();
  document.body.removeChild(form1);
}
Vue.component("scan-box", {
  props: ["show", "data"],
  template: b2_global.scan_box,
  data() {
    return {
      locked: false,
      qrcode: "",
      timeOut: 300,
      timesec: "",
      sTime: "",
      success: "",
      checkTime: "",
      backData: [],
    };
  },
  methods: {
    close() {
      this.$emit("close");
      this.backData = [];
      this.checkTime = null;
    },
    buildOrder() {
      if (this.locked == true) return;
      this.locked = true;
      this.currTime = parseInt(Date.parse(new Date()) / 1000);
      this.endTime = parseInt(this.currTime + this.timeOut);
      this.setTime();
      this.$http
        .post(b2_rest_url + "buildOrder", Qs.stringify(this.data))
        .then((res) => {
          this.backData = res.data;
          if (res.data.type !== "mapay" && res.data.type !== "pay020") {
            var qr = new QRious({ value: this.backData.qrcode, size: 200, level: "L" });
            this.backData.qrcode = qr.toDataURL("image/jpeg");
          }
          this.writeOrder(res.data.order_id);
          this.locked = false;
          this.checkAc();
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    writeOrder(id) {
      b2setCookie("order_id", id);
    },
    checkAc() {
      if ((this.sTime === null && this.success == "fail") || this.checkTime === null || this.show == false) {
        this.checkTime = null;
        return;
      }
      let value = b2getCookie("order_id");
      this.$http.post(b2_rest_url + "payCheck", "order_id=" + value).then((res) => {
        if (res.data.status === "success") {
          if (!b2token) {
            let list = b2getCookie("b2_guest_buy_" + res.data.id + "_" + res.data.type);
            if (!list) {
              list = new Object();
            } else {
              list = JSON.parse(list);
            }
            Reflect.set(list, res.data.index, {
              id: res.data.id,
              order_id: value,
              type: res.data.type,
              index: res.data.index,
            });
            list = JSON.stringify(list);
            b2setCookie("b2_guest_buy_" + res.data.id + "_" + res.data.type, list);
          }
          this.success = true;
          this.checkTime = null;
          if (typeof B2VerifyPage !== "undefined") {
            B2VerifyPage.data.money = true;
            this.close();
          }
          if (typeof carts !== "undefined") {
            carts.step = 3;
            this.close();
          }
          if (this.data.order_type === "circle_read_answer_pay") {
            b2CircleList.afterCommentGetData(
              b2CircleList.answer.listParent,
              b2CircleList.data[b2CircleList.answer.listParent].topic_id,
              "ask",
            );
            this.close();
          }
          if (this.data.order_type === "circle_hidden_content_pay") {
            b2CircleList.afterCommentGetData(
              b2CircleList.hiddenIndex,
              b2CircleList.data[b2CircleList.hiddenIndex].topic_id,
              "hidden",
            );
            this.close();
          }
        } else {
          this.checkTime = setTimeout(() => {
            this.checkAc();
          }, 1000);
        }
      });
    },
    setTime() {
      if (this.show == false) return;
      let diff_time = parseInt(this.endTime - this.currTime);
      let m = Math.floor((diff_time / 60) % 60);
      let s = Math.floor(diff_time % 60);
      this.timesec =
        (m > 0 ? m + "<b>" + b2_global.js_text.global.min + "</b>" : "") +
        s +
        "<b>" +
        b2_global.js_text.global.sec +
        "</b>";
      if (diff_time > 0) {
        this.sTime = setTimeout(() => {
          this.endTime = this.endTime - 1;
          this.setTime();
        }, 1000);
      } else {
        this.sTime = null;
        this.success = "fail";
      }
    },
    refresh() {
      if (this.data.order_type === "circle_read_answer_pay") {
        b2CircleList.afterCommentGetData(
          b2CircleList.answer.listParent,
          b2CircleList.data[b2CircleList.answer.listParent].topic_id,
          "ask",
        );
        this.close();
      } else if (this.data.order_type === "circle_hidden_content_pay") {
        b2CircleList.afterCommentGetData(
          b2CircleList.hiddenIndex,
          b2CircleList.data[b2CircleList.hiddenIndex].topic_id,
          "hidden",
        );
        this.close();
      } else {
        b2CurrentPageReload();
      }
    },
  },
  watch: {
    show(val) {
      if (val) {
        this.sTime = "";
        this.success = false;
        this.checkTime = "";
      } else {
        this.sTime = null;
        this.success = false;
        this.checkTime = null;
      }
    },
    data: {
      deep: true,
      handler(newName, oldName) {
        this.buildOrder();
      },
    },
  },
});
var b2ScanPay = new Vue({
  el: "#scan-box",
  data: { data: [], show: false },
  methods: {
    close() {
      this.show = !this.show;
    },
  },
});
Vue.component("ds-box", {
  props: ["show", "money", "msg", "user", "author", "data", "showtype"],
  template: b2_global.ds_box,
  data() {
    return {
      value: 0,
      custom: 0,
      content: "",
      payType: "",
      payMoney: "",
      locked: false,
      jump: "",
      href: "",
      isWeixin: "",
      isMobile: "",
      allow: [],
      card: [],
      cg: [],
      newWin: null,
      login: false,
      redirect: "",
      payData: "",
      waitOrder: false,
    };
  },
  created() {
    this.isWeixin = b2isWeixin();
    if (b2token) {
      this.login = true;
    }
    this.redirect = b2getCookie("b2_back_url");
  },
  methods: {
    close() {
      this.$emit("close");
      this.locked = false;
    },
    clean() {
      this.$emit("clean");
    },
    picked(m, val) {
      this.value = val;
      this.payMoney = m;
    },
    post(url, params) {
      var temp = document.createElement("form");
      temp.action = url;
      temp.method = "post";
      temp.target = "_blank";
      temp.style.display = "none";
      if (Object.keys(params).length > 0) {
        Object.keys(params).forEach((key) => {
          var opt = document.createElement("input");
          opt.name = key;
          opt.value = params[key];
          temp.appendChild(opt);
        });
      }
      document.body.appendChild(temp);
      temp.submit();
      return temp;
    },
    restData(data = []) {
      if (this.showtype == "ds") {
        data = Object.assign(data, {
          title: this.$refs.dstitle.innerText,
          order_price: this.payMoney,
          order_type: "ds",
          post_id: b2_global.post_id,
          pay_type: this.payType,
          order_content: this.content,
        });
      } else if (this.showtype == "cz") {
        data = {
          title: b2_global.js_text.global.pay_money,
          order_price: this.payMoney,
          order_type: "cz",
          post_id: 0,
          pay_type: this.payType,
        };
      } else if (this.showtype == "cg") {
        data = {
          title: b2_global.js_text.global.pay_credit,
          order_price: this.payMoney,
          order_type: "cg",
          post_id: 0,
          pay_type: this.payType,
        };
      } else {
        data = Object.assign(this.data, data);
      }
      data["pay_type"] = this.payType;
      var url = new URL(window.location.href);
      url.searchParams.set("b2paystatus", "check");
      data["redirect_url"] = url.href;
      return data;
    },
    disabled() {
      if (this.data.pay_type !== "card") {
        if (this.jump == "") return true;
        if (
          (this.jump == "jump" || this.jump == "mweb" || this.jump == "jsapi") &&
          this.href == "" &&
          this.payData == ""
        )
          return true;
        if (this.locked == true) return true;
        if (this.payType == "") return true;
        if (this.payMoney === "") return true;
      } else {
        if (!this.card.number || !this.card.password) return true;
      }
      return false;
    },
    chosePayType(val) {
      if (this.locked == true) return;
      this.locked = true;
      this.payType = val;
      this.href = "";
      this.payData = "";
      this.jump = "";
      this.$http
        .post(b2_rest_url + "checkPayType", "pay_type=" + val)
        .then((res) => {
          if (res.data.pay_type == "card") {
            this.$emit("change", "card");
            this.card.text = res.data.card_text;
            this.jump = res.data.pay_type;
            this.locked = false;
          } else {
            if (this.showtype == "card") {
              this.$emit("change", "cz");
            }
            this.jump = res.data.pay_type;
            this.isMobile = res.data.is_mobile;
            if (this.jump == "jump" || this.jump === "mweb" || this.jump === "jsapi") {
              let data = Qs.stringify(this.restData());
              this.waitOrder = true;
              this.$http
                .post(b2_rest_url + "buildOrder", data)
                .then((res) => {
                  this.writeOrder(res.data.id);
                  if (typeof res.data.url == "string") {
                    this.href = res.data.url;
                  } else {
                    this.payData = res.data.url;
                  }
                  this.waitOrder = false;
                  this.locked = false;
                })
                .catch((err) => {
                  if (err.response.data.message.msg === "bind_weixin") {
                    b2setCookie("b2_back_url", window.location.href);
                    if (typeof err.response.data.message.oauth == "string") {
                      b2weixinBind.msg = err.response.data.message.oauth;
                      b2weixinBind.show = true;
                    } else {
                      b2weixinBind.show = true;
                      b2weixinBind.url = err.response.data.message.oauth.weixin.url;
                    }
                  } else {
                    Qmsg["warning"](err.response.data.message, { html: true });
                  }
                  this.waitOrder = false;
                  this.locked = false;
                });
            } else {
              this.locked = false;
            }
          }
          b2setCookie("b2_back_url", window.location.href);
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    writeOrder(id) {
      b2setCookie("order_id", id);
    },
    balancePay(order_id) {
      let data = this.restData();
      this.$http
        .post(b2_rest_url + "balancePay", "order_id=" + order_id)
        .then((res) => {
          this.close();
          b2PayCheck.show = true;
          b2PayCheck.title = data["title"];
          this.locked = false;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    pay() {
      if (this.disabled()) return;
      if (this.jump === "card") {
        if (this.locked == true) return;
        this.locked = true;
        this.$http
          .post(b2_rest_url + "cardPay", Qs.stringify(this.card))
          .then((res) => {
            if (res.data === "success") {
              b2PayCheck.show = true;
              b2PayCheck.title = b2_global.js_text.global.pay_money_success;
              b2PayCheck.type = "card";
              this.close();
            }
            this.locked = false;
          })
          .catch((err) => {
            Qmsg["warning"](err.response.data.message, { html: true });
            this.locked = false;
          });
      } else if (this.jump === "jump" || this.jump === "mweb") {
        b2PayCheck.show = true;
        b2PayCheck.title = this.$refs.dstitle.innerHTML;
        this.close();
        if (this.payData) {
          this.post(this.payData.url, this.payData.data);
        }
      } else if (this.jump === "balance") {
        if (this.locked == true) return;
        this.locked = true;
        let data = Qs.stringify(this.restData());
        this.$http
          .post(b2_rest_url + "buildOrder", data)
          .then((res) => {
            this.writeOrder(res.data);
            this.balancePay(res.data);
          })
          .catch((err) => {
            Qmsg["warning"](err.response.data.message, { html: true });
            this.locked = false;
          });
      } else if (this.jump === "scan") {
        if (this.isMobile) {
          b2ScanPay.data = this.restData({ is_weixin: this.isWeixin, is_mobile: this.isMobile });
        } else {
          b2ScanPay.data = this.restData();
        }
        b2ScanPay.show = true;
        this.close();
      } else if (this.jump === "jsapi") {
        let data = this.restData();
        jsApiCall(this.payData);
        this.close();
        b2PayCheck.show = true;
        b2PayCheck.title = data["title"];
      }
    },
    allowPayType() {
      this.$http.post(b2_rest_url + "allowPayType", "show_type=" + this.showtype).then((res) => {
        this.allow = res.data;
        this.user.money = res.data.money;
        if (res.data.dh) {
          this.cg.min = res.data.min;
          this.cg.dh = res.data.dh;
          this.payMoney = this.cg.min;
        }
      });
    },
    creditAdd() {
      return parseInt(this.payMoney * this.cg.dh);
    },
  },
  watch: {
    money(val) {
      if (this.payMoney == 0) {
        this.payMoney = val[0];
      }
    },
    show(val) {
      if (val) {
        b2setCookie("b2_back_url", window.location.href);
        this.allowPayType();
      }
      if (val && this.money.length > 0) {
        this.payMoney = this.money[0];
      } else if (val && this.data.length != 0) {
        this.payMoney = this.data.order_price;
      } else if (val == false) {
        setTimeout(() => {
          this.value = 0;
          this.payMoney = 0;
          this.payType = "";
          this.clean();
        }, 300);
      }
    },
    payType(val) {
      this.data.pay_type = val;
    },
    showtype(val) {},
  },
});
var b2DsBox = new Vue({
  el: "#ds-box",
  data: { money: [], show: false, msg: "", user: [], author: [], data: [], showtype: "" },
  methods: {
    close() {
      this.show = !this.show;
    },
    clean() {
      this.data = [];
      this.money = [];
    },
    change(type) {
      this.showtype = type;
    },
  },
});
var b2Ds = new Vue({
  el: "#content-ds",
  data: { data: "" },
  methods: {
    show() {
      b2DsBox.money = this.data.moneys;
      b2DsBox.show = true;
      b2DsBox.showtype = "ds";
      b2DsBox.msg = this.data.single_post_ds_text;
    },
  },
});
function b2pay(event) {
  let data = JSON.parse(event.getAttribute("data-pay"));
  b2DsBox.data = data;
  b2DsBox.show = true;
  b2DsBox.showtype = "normal";
}
function b2creditpay(event) {
  if (!b2token) {
    login.show = true;
  } else {
    let data = JSON.parse(event.getAttribute("data-pay"));
    payCredit.data = data;
    payCredit.show = true;
  }
}
function uuid(len, radix) {
  var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");
  var uuid = [],
    i;
  radix = radix || chars.length;
  if (len) {
    for (i = 0; i < len; i++) uuid[i] = chars[0 | (Math.random() * radix)];
  } else {
    var r;
    uuid[8] = uuid[13] = uuid[18] = uuid[23] = "-";
    uuid[14] = "4";
    for (i = 0; i < 36; i++) {
      if (!uuid[i]) {
        r = 0 | (Math.random() * 16);
        uuid[i] = chars[i == 19 ? (r & 0x3) | 0x8 : r];
      }
    }
  }
  return uuid.join("");
}
function openWin(url, name, iWidth, iHeight) {
  var iTop = (window.screen.availHeight - 30 - iHeight) / 2;
  var iLeft = (window.screen.availWidth - 10 - iWidth) / 2;
  window.open(
    url,
    name,
    "height=" +
      iHeight +
      ",innerHeight=" +
      iHeight +
      ",width=" +
      iWidth +
      ",innerWidth=" +
      iWidth +
      ",top=" +
      iTop +
      ",left=" +
      iLeft +
      ",status=no,toolbar=no,menubar=no,location=no,resizable=no,scrollbars=0,titlebar=no",
  );
}
function deleteHtmlTag(str) {
  str = str.replace(/<[^>]+>|&[^>]+;/g, "").trim();
  return str;
}
var b2cache = [];
function b2addJs(path, callback) {
  var flag = 0;
  for (var i = b2cache.length; i--;) {
    b2cache[i] == path ? (flag = 1) : (flag = 0);
  }
  if (flag) {
    return;
  }
  var head = document.getElementsByTagName("head")[0];
  var script = document.createElement("script");
  script.src = path;
  script.type = "text/javascript";
  head.appendChild(script);
  script.onload = script.onreadystatechange = function () {
    if (!this.readyState || this.readyState === "loaded" || this.readyState === "complete") {
      script.onload = script.onreadystatechange = null;
      callback();
    }
  };
  b2cache.push(path);
}
function jsApiCall(data) {
  WeixinJSBridge.invoke("getBrandWCPayRequest", data, function (res) {});
}
function callpay() {
  if (typeof WeixinJSBridge == "undefined") {
    if (document.addEventListener) {
      document.addEventListener("WeixinJSBridgeReady", jsApiCall, passiveSupported ? { passive: true } : false);
    } else if (document.attachEvent) {
      document.attachEvent("WeixinJSBridgeReady", jsApiCall);
      document.attachEvent("onWeixinJSBridgeReady", jsApiCall);
    }
  } else {
    jsApiCall();
  }
}
function b2SidebarSticky() {
  if (B2ClientWidth <= 768) return;
  if (document.querySelector(".post-style-5")) return;
  if (typeof window.b2Stick !== "undefined") {
    for (let i = 0; i < window.b2Stick.length; i++) {
      if (window.b2Stick[i]) {
        window.b2Stick[i].updateSticky();
      }
    }
    return;
  }
  let b2sidebar = document.querySelectorAll(".sidebar");
  if (b2sidebar) {
    if (B2ClientWidth > 768) {
      var b2Stick = [];
      for (let i = 0; i < b2sidebar.length; i++) {
        if (!b2sidebar[i].querySelector(".widget-ffixed")) continue;
        b2Stick[i] = new StickySidebar(b2sidebar[i], {
          containerSelector: ".widget-area",
          topSpacing: 20,
          resizeSensor: true,
          bottomSpacing: 20,
        });
      }
      window.b2Stick = b2Stick;
    }
  }
}
Vue.component("credit-box", {
  props: ["show", "data", "user"],
  template: b2_global.credit_box,
  data() {
    return { locked: false };
  },
  methods: {
    close() {
      this.$emit("close");
    },
    writeOrder(id) {
      b2setCookie("order_id", id);
    },
    disabled() {
      if (this.locked === true) return true;
      if (parseInt(this.user.credit) < parseInt(this.data.order_price)) return true;
      return false;
    },
    creditPay(order_id) {
      this.writeOrder(order_id);
      this.$http
        .post(b2_rest_url + "creditPay", "order_id=" + order_id)
        .then((res) => {
          this.locked = false;
          b2PayCheck.show = true;
          this.close();
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
    pay() {
      if (this.locked == true) return;
      this.locked = true;
      this.data.pay_type = "credit";
      let data = Qs.stringify(this.data);
      this.$http
        .post(b2_rest_url + "buildOrder", data)
        .then((res) => {
          this.creditPay(res.data);
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
  },
});
var payCredit = new Vue({
  el: "#credit-box",
  data: { show: false, data: [], user: { credit: 0 }, author: [] },
  methods: {
    close() {
      this.show = !this.show;
    },
  },
});
var B2UserWidget = new Vue({
  el: ".b2-widget-user",
  data: { show: false, b2token: false },
  mounted() {
    this.b2token = b2token;
  },
  computed: {
    userData() {
      return this.$store.state.userData;
    },
    oauth() {
      return this.$store.state.oauthLink;
    },
    announcement() {
      return this.$store.state.announcement;
    },
    openOauth() {
      return this.$store.state.openOauth;
    },
  },
  watch: {
    announcement(val) {
      if (val && !this.show) {
        this.resize();
      }
    },
  },
  methods: {
    resize() {
      this.$nextTick(() => {
        if (!this.$refs.userWidget) return;
        if (this.$refs.gujia) {
          this.$refs.gujia.style.display = "none";
        }
        setTimeout(() => {
          b2tooltip(".user-w-tips");
        }, 300);
        this.show = true;
      });
    },
    markHistory(type) {
      if (this.oauth.weixin.mp && type === "weixin") {
        mpCode.show = true;
      }
      b2setCookie("b2_back_url", window.location.href);
    },
  },
});
var b2Mission = new Vue({
  el: ".b2-widget-mission",
  data: { data: "", locked: false, type: "today", paged: 1, count: 0, pages: { today: 1, always: 1 } },
  mounted() {
    if (this.$refs.missionWidget) {
      this.getData();
    }
  },
  methods: {
    getData(count, paged) {
      if (this.$refs.missionWidget) {
        this.count = this.$refs.missionWidget.getAttribute("data-count");
      } else {
        this.count = 10;
      }
      if (paged) {
        this.paged = paged;
      }
      this.$http.post(b2_rest_url + "getUserMission", "count=" + this.count + "&paged=" + this.paged).then((res) => {
        this.data = res.data;
        this.pages.today = res.data.mission_today_list.pages;
        this.pages.always = res.data.mission_always_list.pages;
        if (this.$refs.missiongujia) {
          this.$refs.missiongujia.style.display = "none";
        }
        this.$nextTick(() => {
          b2RestTimeAgo(this.$el.querySelectorAll(".b2timeago"));
        });
      });
    },
    mission() {
      if (!b2token) {
        login.show = true;
      } else {
        if (this.data.mission.credit) {
          Qmsg["warning"](b2_global.js_text.global.has_mission, { html: true });
          return;
        }
        if (this.locked == true) return;
        this.locked = true;
        this.$http
          .post(b2_rest_url + "userMission")
          .then((res) => {
            this.$nextTick(() => {
              this.data.mission = res.data.mission;
              this.locked = false;
            });
            this.getData(this.count, this.paged);
          })
          .catch((err) => {
            Qmsg["warning"](err.response.data.message, { html: true });
            this.locked = false;
          });
      }
    },
  },
});
var b2NewComment = new Vue({
  el: ".b2-widget-comment",
  data: { data: "", paged: 1, pages: 1, count: 5, hidden: 1, next: false, prev: false, locked: false },
  mounted() {
    if (this.$refs.commentWidget) {
      this.count = this.$refs.commentWidget.getAttribute("data-count");
      this.hidden = this.$refs.commentWidget.getAttribute("data-hidden");
      this.getList();
      if (this.paged == 1) {
        this.prev = true;
      }
    }
  },
  methods: {
    getList() {
      if (this.locked == true) return;
      this.locked = true;
      this.$https
        .post(b2_rest_url + "getNewComments", "paged=" + this.paged + "&count=" + this.count + "&hidden=" + this.hidden)
        .then((res) => {
          this.data = res.data.data;
          this.pages = res.data.pages;
          if (this.$refs.gujia) {
            this.$refs.gujia.style.display = "none";
          }
          this.$nextTick(() => {
            b2SidebarSticky();
            b2RestTimeAgo(this.$refs.commentWidget.querySelectorAll(".b2timeago"));
          });
          this.locked = false;
        });
    },
    nexAc() {
      if (this.next || this.locked) return;
      this.paged++;
      this.getList();
    },
    prevAc() {
      if (this.prev || this.locked) return;
      this.paged--;
      this.getList();
    },
  },
  watch: {
    paged(val) {
      if (val <= 1) {
        this.prev = true;
      } else {
        this.prev = false;
      }
      if (val >= this.pages) {
        this.next = true;
      } else {
        this.next = false;
      }
    },
  },
});
var b2mobileFooterMenu = new Vue({ el: "#mobile-footer-menu", data: { msg: 0, show: true } });
var postPoBox = new Vue({
  el: "#post-po-box",
  data: { show: false, login: false, allow: "" },
  mounted() {
    if (b2token) {
      this.login = true;
    }
  },
  methods: {
    close() {
      this.showPost = !this.showPost;
    },
    go(val, type) {
      if (!this.login) {
        login.show = true;
        login.type = 0;
        return;
      }
      if (type != "request") {
        if (!userTools.role[type]) {
          Qmsg["warning"](b2_global.js_text.global.not_allow, { html: true });
          return;
        }
      }
      setTimeout(() => {
        window.location.href = val;
      }, 250);
    },
  },
});
var b2AsideBar = new Vue({
  el: ".aside-container",
  data: {
    dmsg: { count: 0 },
    msg: { count: 0 },
    showBox: false,
    showType: { user: false, msg: false, dmsg: false, mission: false, coupon: false },
    locked: false,
    mission: [],
    bool: false,
    coupon: { count: 0, data: "" },
    showCouponInfo: [],
    qrcode: "",
    ref: "",
    dlocked: false,
    count: 0,
    cartLocked: false,
    b2token: false,
  },
  computed: {
    userData() {
      return this.$store.state.userData;
    },
    carts() {
      if (this.count && !this.cartLocked) {
        return { count: this.count, data: "" };
      } else {
        let carts = this.$store.state.carts;
        return { count: carts !== null && carts !== undefined ? Object.keys(carts).length : 0, data: carts };
      }
    },
  },
  mounted() {
    this.b2token = b2token;
  },
  methods: {
    getQrcode(url) {
      var url = new URL(url);
      url.searchParams.set("ref", this.ref);
      var qr = new QRious({ value: url.href, size: 120, level: "L" });
      return qr.toDataURL("image/jpeg");
    },
    goMyPage() {
      if (!b2token) {
        login.show = true;
        login.type = 0;
        return;
      }
      window.location.href = this.userData.link;
    },
    chat() {
      if (b2_global.chat.type == "crisp") {
        $crisp.push(["do", "chat:open"]);
      }
      if (b2_global.chat.type == "qq") {
        window.open("http://wpa.qq.com/msgrd?v=3&uin=" + b2_global.chat.qq + "&site=qq&menu=yes", "_blank");
      }
      if (b2_global.chat.type == "dmsg") {
        if (!b2token) {
          login.show = true;
        } else {
          b2Dmsg.userid = b2_global.chat.dmsg;
          b2Dmsg.show = true;
        }
      }
      if (b2_global.chat.type == "requests") {
        if (!b2token) {
          login.show = true;
        } else {
          window.open(b2_global.home_url + "/requests", "_blank");
        }
      }
    },
    show(type, value) {
      this.closeBox();
      if (type === "user") {
        if (!b2token) {
          login.show = true;
          login.type = 0;
          return;
        }
      }
      if (type === "dmsg" && this.dmsg.count == 0) {
        if (!b2token) {
          login.show = true;
          login.type = 0;
          return;
        }
        this.jumpTo(value);
        return;
      }
      if (type === "msg") {
        if (!b2token) {
          login.show = true;
          login.type = 0;
          return;
        }
        this.jumpTo(value);
        return;
      }
      if (type == "mission") {
        this.mission = b2Mission;
        if (this.mission.data.length == 0) {
          this.mission.getData(10);
        }
      }
      if (type === "coupon") {
        this.getMyCoupons();
      }
      if (type === "cart") {
        if (!b2token) {
          login.show = true;
          login.type = 0;
          return;
        }
        this.getMycarts();
      }
      this.showType[type] = true;
      this.showBox = true;
      this.$nextTick(() => {
        b2RestTimeAgo(this.$el.querySelectorAll(".b2timeago"));
      });
    },
    getMycarts() {
      if (this.cartLocked == true) return;
      this.cartLocked = true;
      this.$http.get(b2_rest_url + "getMyCarts").then((res) => {
        if (Object.keys(res.data).length > 0) {
          this.$store.commit("setcartsData", res.data);
        }
      });
    },
    showAc(val) {
      if (!b2token) {
        login.show = true;
        return;
      }
      if (val) {
        this.show("user");
      } else {
        this.close();
      }
    },
    closeBox() {
      Object.keys(this.showType).forEach((key) => {
        this.showType[key] = false;
      });
      this.showBox = false;
    },
    getNewDmsg() {
      if (b2token) {
        if (this.locked) return;
        this.locked = true;
        this.$http.post(b2_rest_url + "getNewDmsg").then((res) => {
          this.dmsg = res.data.dmsg;
          this.locked = false;
        });
      }
    },
    close() {
      if (
        this.$refs.asideContainer &&
        this.$refs.asideContainer.className.indexOf("aside-show") &&
        B2ClientWidth < 768
      ) {
        this.$refs.asideContainer.className = this.$refs.asideContainer.className.replace(" aside-show", "");
        this.showBox = false;
      } else {
        this.closeBox();
      }
    },
    goTop() {
      this.$scrollTo(".site", 300, { offset: 0 });
    },
    login() {
      if (!b2token) {
        login.show = true;
        return;
      } else if (!this.$refs.asideContent) {
        self.location = this.$store.state.userData.link;
      } else {
        this.show("user");
        this.$refs.asideContainer.className += " aside-show";
      }
    },
    showSearch() {
      b2SearchBox.close();
    },
    jumpTo(url) {
      window.location.href = url;
    },
    updateCarts() {
      let data = b2getCookie("carts");
      if (data) {
        this.carts.data = JSON.parse(data);
      } else {
        this.carts.data = "";
      }
      if (this.carts.data) {
        if (this.carts.count > Object.keys(this.carts.data).length) {
          b2mobileFooterMenu.msg = b2mobileFooterMenu.msg - (this.carts.count - Object.keys(this.carts.data).length);
        } else {
          b2mobileFooterMenu.msg = b2mobileFooterMenu.msg + (Object.keys(this.carts.data).length - this.carts.count);
        }
        this.carts.count = Object.keys(this.carts.data).length;
      }
    },
    deleteCarts(id) {
      this.$https.post(b2_rest_url + "deleteMyCarts", "id=" + id).then((res) => {
        if (res.data.length == 0) {
          this.$store.commit("setcartsData", {});
        } else {
          this.$store.commit("setcartsData", res.data);
        }
      });
    },
    getMyCoupons() {
      if (!b2token) {
        login.show = true;
        return;
      }
      this.showType.coupon = true;
      this.$https.get(b2_rest_url + "getMyCoupons").then((res) => {
        this.coupon = res.data;
      });
    },
    couponClass(item) {
      if (item.expiration_date.expired) return "stamp04";
      if (item.products.length > 0) return "stamp01";
      if (item.cats.length > 0) return "stamp02";
      return "stamp03";
    },
    couponMoreInfo(id) {
      this.$set(this.showCouponInfo, id, !this.showCouponInfo[id]);
    },
    deleteCoupon(id) {
      var r = confirm(b2_global.js_text.global.delete_coupon);
      if (r) {
        this.$https.post(b2_rest_url + "deleteMyCoupon", "id=" + id).then((res) => {
          this.$delete(this.coupon.data, id);
          this.$set(this.coupon, "count", this.coupon.count - 1);
        });
      }
      return;
    },
  },
  watch: {
    userData(val) {
      if (val && this.$refs.asideContent) {
        if (b2token) {
          this.ref = val.user_code;
          this.getNewDmsg();
        }
        this.updateCarts();
      }
    },
    dmsg: {
      handler(newVal, old) {
        if (newVal.count > 0) {
          b2mobileFooterMenu.msg += parseInt(newVal.count);
        }
      },
      immediate: true,
      deep: true,
    },
    msg: {
      handler(newVal, old) {
        if (newVal.count > 0) {
          b2mobileFooterMenu.msg += parseInt(newVal.count);
        }
      },
      immediate: true,
      deep: true,
    },
    showBox(val) {
      if (val && B2ClientWidth < 768) {
        this.$refs.asideContainer.className += " aside-show";
      }
    },
  },
});
function b2HiddenFilterBox(event) {
  event.parentNode.parentNode.className = event.parentNode.parentNode.className.replace("b2-show", "");
}
function b2flickity() {
  if (B2ClientWidth < 768) return;
  var f = document.querySelectorAll(".home-collection-silder");
  if (f) {
    var collection = [];
    for (let i = 0; i < f.length; i++) {
      collection[i] = new Flickity(f[i], {
        pageDots: false,
        groupCells: true,
        draggable: true,
        prevNextButtons: false,
        freeScroll: false,
        wrapAround: true,
        selectedAttraction: 0.15,
        friction: 1,
        freeScrollFriction: 0.1,
        cellAlign: "left",
      });
      let previous, next;
      if (f[i].querySelector(".coll-3-box")) {
        previous = f[i].parentNode.querySelector(".collection-previous");
      } else {
        previous = f[i].parentNode.parentNode.parentNode.querySelector(".collection-previous");
      }
      previous.addEventListener(
        "click",
        function () {
          collection[i].previous();
        },
        passiveSupported ? { passive: true } : false,
      );
      if (f[i].querySelector(".coll-3-box")) {
        next = f[i].parentNode.querySelector(".collection-next");
      } else {
        next = f[i].parentNode.parentNode.parentNode.querySelector(".collection-next");
      }
      next.addEventListener(
        "click",
        function () {
          collection[i].next();
        },
        passiveSupported ? { passive: true } : false,
      );
    }
  }
}
b2flickity();
function b2HiddenFooter() {
  let footer = document.querySelector(".site-footer .site-footer-widget-in");
  if (!footer) return;
  let footerWidget = footer.querySelectorAll(".mobile-hidden");
  if (footerWidget && footerWidget.length >= footer.childNodes.length) {
    document.querySelector(".site-footer").className += " mobile-hidden";
  }
}
b2HiddenFooter();
var b2SearchUser = new Vue({
  el: "#user-list",
  data: { follow: [], ids: [] },
  mounted() {
    if (this.$refs.searchUser) {
      this.ids = b2_search_data.users;
      this.checkFollowByids();
    }
  },
  methods: {
    checkFollowByids() {
      let data = { ids: this.ids };
      this.$http.post(b2_rest_url + "checkFollowByids", Qs.stringify(data)).then((res) => {
        this.follow = res.data;
      });
    },
    followAc(id) {
      if (!b2token) {
        login.show = true;
      } else {
        this.$http
          .post(b2_rest_url + "AuthorFollow", "user_id=" + id)
          .then((res) => {
            this.follow[id] = res.data;
          })
          .catch((err) => {
            Qmsg["warning"](err.response.data.message, { html: true });
          });
      }
    },
    dmsg(id) {
      if (!b2token) {
        login.show = true;
      } else {
        b2Dmsg.userid = id;
        b2Dmsg.show = true;
      }
    },
  },
});
(function () {
  var calc = {
    Add: function (arg1, arg2) {
      ((arg1 = arg1.toString()), (arg2 = arg2.toString()));
      var arg1Arr = arg1.split("."),
        arg2Arr = arg2.split("."),
        d1 = arg1Arr.length == 2 ? arg1Arr[1] : "",
        d2 = arg2Arr.length == 2 ? arg2Arr[1] : "";
      var maxLen = Math.max(d1.length, d2.length);
      var m = Math.pow(10, maxLen);
      var result = Number(((arg1 * m + arg2 * m) / m).toFixed(maxLen));
      var d = arguments[2];
      return typeof d === "number" ? Number(result.toFixed(d)) : result;
    },
    Sub: function (arg1, arg2) {
      return Calc.Add(arg1, -Number(arg2), arguments[2]);
    },
    Mul: function (arg1, arg2) {
      var r1 = arg1.toString(),
        r2 = arg2.toString(),
        m,
        resultVal,
        d = arguments[2];
      m = (r1.split(".")[1] ? r1.split(".")[1].length : 0) + (r2.split(".")[1] ? r2.split(".")[1].length : 0);
      resultVal = (Number(r1.replace(".", "")) * Number(r2.replace(".", ""))) / Math.pow(10, m);
      return typeof d !== "number" ? Number(resultVal) : Number(resultVal.toFixed(parseInt(d)));
    },
    Div: function (arg1, arg2) {
      var r1 = arg1.toString(),
        r2 = arg2.toString(),
        m,
        resultVal,
        d = arguments[2];
      m = (r2.split(".")[1] ? r2.split(".")[1].length : 0) - (r1.split(".")[1] ? r1.split(".")[1].length : 0);
      resultVal = (Number(r1.replace(".", "")) / Number(r2.replace(".", ""))) * Math.pow(10, m);
      return typeof d !== "number" ? Number(resultVal) : Number(resultVal.toFixed(parseInt(d)));
    },
  };
  window.Calc = calc;
})();
function b2stmap() {
  let stmaps = document.querySelectorAll(".stamp");
  if (stmaps.length > 0) {
    let h_axios = axios;
    if (b2token) {
      h_axios.defaults.headers.common["Authorization"] = "Bearer " + b2token;
    }
    for (let i = 0; i < stmaps.length; i++) {
      if (stmaps[i].querySelector(".coupon-receive")) {
        stmaps[i].querySelector(".coupon-receive").onclick = (event) => {
          if (!b2token) {
            login.show = true;
            return;
          }
          h_axios
            .post(b2_rest_url + "ShopCouponReceive", "&id=" + event.target.getAttribute("data-id"))
            .then((res) => {
              if (res.data) {
                Qmsg["success"](b2_global.js_text.global.get_success, { html: true });
              }
            })
            .catch((err) => {
              Qmsg["success"](err.response.data.message, { html: true });
            });
        };
        stmaps[i].querySelector(".more-coupon-info").onclick = (event) => {
          event.target.nextElementSibling.style.display = "block";
        };
        stmaps[i].querySelector(".close-coupon-info").onclick = (event) => {
          event.target.parentNode.parentNode.style.display = "none";
        };
      }
    }
  }
}
b2stmap();
function b2IsPhoneAvailable(phonevalue) {
  var phoneReg = /^1[0-9]{10}/;
  var emailReg = /[a-zA-Z0-9]{1,10}@[a-zA-Z0-9]{1,5}\.[a-zA-Z0-9]{1,5}/;
  if (phoneReg.test(phonevalue) || emailReg.test(phonevalue)) {
    return true;
  } else {
    return false;
  }
}
var b2TaxTop = new Vue({
  el: ".tax-header",
  data: { showFliter: { hot: false, cat: false } },
  methods: {
    show(type) {
      if (type === "hot") {
        this.showFliter.hot = !this.showFliter.hot;
        this.showFliter.cat = false;
      }
      if (type === "cat") {
        this.showFliter.cat = !this.showFliter.cat;
        this.showFliter.hot = false;
      }
    },
  },
});
function b2scroll(fn) {
  var beforeScrollTop = document.documentElement.scrollTop,
    fn = fn || function () {};
  window.bodyScrool = function () {
    var afterScrollTop = document.documentElement.scrollTop || document.body.scrollTop,
      delta = afterScrollTop - beforeScrollTop;
    if (delta === 0) return false;
    fn(delta > 0 ? "down" : "up", afterScrollTop);
    beforeScrollTop = afterScrollTop;
  };
  window.addEventListener("scroll", window.bodyScrool, passiveSupported ? { passive: true } : false);
}
function b2HeaderTop() {
  const banner = document.querySelector(".header-banner-left");
  const header = document.querySelector(".site");
  const aside = document.querySelector(".bar-user-info");
  const socialTop = document.querySelector(".social-top");
  const nosub = document.querySelector(".social-no-sub");
  const footer = document.querySelector(".mobile-footer-menu");
  if (!banner) return;
  let h = 96;
  if (B2ClientWidth < 768) {
    h = 77;
  }
  if (socialTop) {
    h = 113;
  }
  if (nosub) {
    h = 58;
  }
  b2scroll(function (direction, top) {
    if (top > h) {
      if (direction === "down") {
        if (banner.className.indexOf(" hidden") === -1) {
          banner.className += " hidden";
        }
        if (header.className.indexOf(" up") === -1) {
          header.className += " up";
        }
        if (footer && B2ClientWidth < 768 && footer.className.indexOf(" footer-down") === -1) {
          footer.className += " footer-down";
        }
      } else {
        banner.className = banner.className.replace(" hidden", "");
        header.className = header.className.replace(" up", "");
        if (footer && B2ClientWidth < 768) {
          footer.className = footer.className.replace(" footer-down", "");
        }
      }
      if (header.className.indexOf(" action") === -1) {
        header.className += " action";
      }
    } else {
      header.className = header.className.replace(" action", "");
      banner.className = banner.className.replace(" hidden", "");
      header.className = header.className.replace(" up", "");
    }
  });
}
b2HeaderTop();
var b2NewsfalshesWidget = new Vue({
  el: ".widget-newsflashes-box",
  data: { options: [], list: "" },
  mounted() {
    if (this.$refs.newsWidget) {
      this.options = JSON.parse(this.$refs.newsWidget.getAttribute("data-json"));
      this.getList();
    }
  },
  methods: {
    getList() {
      this.$https.post(b2_rest_url + "getWidgetNewsflashes", Qs.stringify(this.options)).then((res) => {
        this.list = res.data;
        this.$refs.gujia.style.display = "none";
      });
    },
  },
});
Vue.component("weixin-bind", {
  props: ["show", "url", "msg"],
  template: b2_global.weixin_bind,
  methods: {
    close() {
      this.$emit("close");
    },
  },
});
var b2weixinBind = new Vue({
  el: "#weixin-bind",
  data: { show: false, url: "", msg: "" },
  methods: {
    close() {
      this.show = !this.show;
    },
  },
});
function b2CurrentPageReload(url) {
  if (!url) {
    url = location.href;
  }
  setTimeout(() => {
    location.replace(url);
  }, 200);
}
function b2GetQueryVariable(variable) {
  var query = window.location.search.substring(1);
  var vars = query.split("&");
  for (var i = 0; i < vars.length; i++) {
    var pair = vars[i].split("=");
    if (pair[0] == variable) {
      return pair[1];
    }
  }
  return false;
}
function b2removeURLParameter(url, parameter) {
  var urlparts = url.split("?");
  if (urlparts.length >= 2) {
    var prefix = encodeURIComponent(parameter) + "=";
    var pars = urlparts[1].split(/[&;]/g);
    for (var i = pars.length; i-- > 0;) {
      if (pars[i].lastIndexOf(prefix, 0) !== -1) {
        pars.splice(i, 1);
      }
    }
    return urlparts[0] + (pars.length > 0 ? "?" + pars.join("&") : "");
  }
  return url;
}
function updateURLParameter(uri, key, value) {
  if (!value) {
    return uri;
  }
  var re = new RegExp("([?&])" + key + "=.*?(&|$)", "i");
  var separator = uri.indexOf("?") !== -1 ? "&" : "?";
  if (uri.match(re)) {
    return uri.replace(re, "$1" + key + "=" + value + "$2");
  } else {
    return uri + separator + key + "=" + value;
  }
}
function validate(evt) {
  var theEvent = evt || window.event;
  if (theEvent.type === "paste") {
    key = event.clipboardData.getData("text/plain");
  } else {
    var key = theEvent.keyCode || theEvent.which;
    key = String.fromCharCode(key);
  }
  var regex = /[0-9]|\./;
  if (!regex.test(key)) {
    theEvent.returnValue = false;
    if (theEvent.preventDefault) theEvent.preventDefault();
  }
}
Vue.component("bind-login", {
  props: ["show", "type"],
  template: b2_global.bind_login,
  data() {
    return {
      locked: false,
      count: 60,
      SMSLocked: false,
      data: { img_code: "", token: "", username: "", password: "", confirmPassword: "", code: "" },
      eye: false,
      success: "",
    };
  },
  computed: {
    userData() {
      return this.$store.state.userData;
    },
  },
  methods: {
    close() {
      this.$emit("close");
    },
    showCheck() {
      if (this.type !== "text" && this.type !== "luo" && this.data.username && this.show) {
        return true;
      }
      return false;
    },
    sendCode() {
      recaptcha.show = true;
      recaptcha.type = "bind";
      this.close();
    },
    sendSMS() {
      if (this.SMSLocked == true) return;
      this.SMSLocked = true;
      this.$http
        .post(b2_rest_url + "sendCode", Qs.stringify(this.data))
        .then((res) => {
          if (res.data.token) {
            this.countdown();
            this.data.smsToken = res.data.token;
          }
          this.SMSLocked = false;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.SMSLocked = false;
        });
    },
    countdown() {
      if (this.count <= 1) {
        this.count = 60;
        return;
      }
      this.count--;
      setTimeout(() => {
        this.countdown();
      }, 1000);
    },
    setToken(val) {
      this.data.img_code = val.value;
      this.data.token = val.token;
      this.sendSMS();
    },
    submit() {
      if (this.locked) return;
      this.locked = true;
      this.$http
        .post(b2_rest_url + "bindUserLogin", Qs.stringify(this.data))
        .then((res) => {
          this.success = res.data;
          this.locked = false;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
  },
});
var b2bindLogin = new Vue({
  el: "#binding-login",
  data: { show: false, type: false },
  methods: {
    close() {
      this.show = !this.show;
    },
    imgCodeAc(val) {
      this.$refs.bindBox.setToken(val);
    },
  },
  watch: {
    type(val) {
      if (val) {
        this.show = true;
      }
    },
  },
});
var b2CreditTop = new Vue({
  el: ".credit-top",
  data: { settings: [], data: "" },
  mounted() {
    if (this.$refs.creditTop) {
      this.settings = JSON.parse(this.$refs.creditTop.getAttribute("data-settings"));
      this.getList();
    }
  },
  methods: {
    getList() {
      this.$http.post(b2_rest_url + "getGoldTop", Qs.stringify(this.settings)).then((res) => {
        this.data = res.data;
        this.$nextTick(() => {
          this.$refs.creditTopGujia.style.display = "none";
        });
      });
    },
  },
});
function grin(tag, myField) {
  if (document.selection) {
    myField.focus();
    sel = document.selection.createRange();
    sel.text = tag;
    myField.focus();
  } else if (myField.selectionStart || myField.selectionStart == "0") {
    var startPos = myField.selectionStart;
    var endPos = myField.selectionEnd;
    var cursorPos = startPos;
    myField.value = myField.value.substring(0, startPos) + tag + myField.value.substring(endPos, myField.value.length);
    cursorPos += tag.length;
    myField.focus();
    myField.selectionStart = cursorPos;
    myField.selectionEnd = cursorPos;
  } else {
    myField.value += tag;
    myField.focus();
  }
}
var b2HotCircle = new Vue({
  el: ".b2-widget-hot-circle",
  data: { data: "", count: 6, type: "hot", paged: { hot: 1, join: 1, create: 1 }, locked: false },
  mounted() {
    if (!this.$refs.hotCircle) return;
    this.count = this.$refs.hotCircle.getAttribute("data-count");
    this.getCirclesList("hot");
  },
  methods: {
    go(link) {
      window.location.href = link;
    },
    getCirclesList(type) {
      if (!b2token && type !== "hot") {
        login.show = true;
        login.type = 1;
        return;
      }
      if (this.locked === true) return;
      this.locked = true;
      let data = { count: this.count, type: type, paged: this.paged[type] };
      this.$refs.gujia.style.display = "block";
      this.data = "";
      this.$http
        .post(b2_rest_url + "getCirclesList", Qs.stringify(data))
        .then((res) => {
          this.data = res.data;
          this.$nextTick(() => {
            this.$refs.gujia.style.display = "none";
            b2SidebarSticky();
            lazyLoadInstance.update();
          });
          this.type = type;
          this.locked = false;
        })
        .catch((err) => {
          Qmsg["warning"](err.response.data.message, { html: true });
          this.locked = false;
        });
    },
  },
});
if (!window.scrollTo) {
  window.scrollTo = function (x, y) {
    window.pageXOffset = x;
    window.pageYOffset = y;
  };
}
if (!window.scrollBy) {
  window.scrollBy = function (x, y) {
    window.pageXOffset += x;
    window.pageYOffset += y;
  };
}
if (!document.body.scrollTo) {
  Element.prototype.scrollTo = function (x, y) {
    this.scrollLeft = x;
    this.scrollTop = y;
  };
}
if (!document.body.scrollBy) {
  Element.prototype.scrollBy = function (x, y) {
    this.scrollLeft += x;
    this.scrollTop += y;
  };
}
var payReturn = new Vue({
  el: "#pay-return",
  data: { login: false },
  mounted() {
    if (b2token) {
      this.login = true;
    }
  },
});
const searchBox = document.querySelectorAll(".search-module");
if (searchBox) {
  for (let index = 0; index < searchBox.length; index++) {
    let id = searchBox[index].getAttribute("data-i");
    new Vue({
      el: "#search-module-" + id,
      data: { link: b2_global.home_url, keyword: "", category: b2_global.js_text.global.all, show: false },
      mounted() {
        document.onclick = (e) => {
          this.show = false;
          userTools.hideAction();
        };
      },
      methods: {
        picked(id, category, link) {
          this.link = link;
          this.category = category;
          this.show = false;
        },
        pickedKey(key) {},
      },
    });
  }
}
var b2recommendedCircle = new Vue({
  el: ".b2-widget-recommended-circle",
  data: { data: "", current: 0 },
  mounted() {
    if (!this.$refs.recommendedGujia) return;
    this.getCircles();
  },
  methods: {
    create() {
      if (!b2token) {
        login.show = true;
        login.loginType = 1;
      } else {
        window.open(b2_global.home_url + "/create-circle", "_blank");
      }
    },
    getCircles() {
      let ids = JSON.parse(this.$refs.recommendedGujia.getAttribute("data-ids"));
      if (ids.length == 0) return;
      let data = { ids: ids };
      this.$http.post(b2_rest_url + "getCircleDataByCircleIds", Qs.stringify(data)).then((res) => {
        this.data = res.data;
        this.$nextTick(() => {
          this.$refs.recommendedGujia.style.display = "none";
          if (typeof b2CirclePostBox != "undefined") {
            if (b2CirclePostBox.$refs.textareaTopic) {
              this.current = parseInt(b2CirclePostBox.$refs.textareaTopic.getAttribute("data-circle"));
            }
          }
          this.$nextTick(() => {
            lazyLoadInstance.update();
          });
          b2SidebarSticky();
        });
      });
    },
    go(even, index) {
      if (typeof b2CirclePostBox != "undefined") {
        even.stopPropagation();
        even.preventDefault();
        let id = this.data[index].id;
        b2CirclePostBox.circle.picked = id;
        this.current = id;
        b2CircleList.pickedCircle("widget", id);
        b2CirclePostBox.getCurrentUserCircleData();
        window.history.pushState(id, this.data[index].name, this.data[index].link);
        document.title = this.data[index].name + " " + b2_global.site_separator + " " + b2_global.site_name;
        return false;
      }
    },
  },
});
document.b2ready = function (callback) {
  if (document.addEventListener) {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        document.removeEventListener("DOMContentLoaded", arguments.callee, false);
        callback();
      },
      false,
    );
  } else if (document.attachEvent) {
    document.attachEvent("onreadystatechange", function () {
      if (document.readyState == "complete") {
        document.detachEvent("onreadystatechange", arguments.callee);
        callback();
      }
    });
  } else if (document.lastChild == document.body) {
    callback();
  }
};
function b2tooltip(cla) {
  const d = document.querySelectorAll(cla);
  if (!d) return;
  if (B2ClientWidth < 768) return;
  var x = 15;
  var y = 10;
  window.b2thistip = [];
  for (let i = 0; i < d.length; i++) {
    d[i].addEventListener(
      "mouseover",
      function (e) {
        var tooltip = "<div class='b2tooltip' id='b2tooltip" + i + "'>" + this.getAttribute("data-title") + "</div>";
        document.body.insertAdjacentHTML("beforeend", tooltip);
        window.b2thistip[i] = document.querySelector("#b2tooltip" + i);
        window.b2thistip[i].style.top = e.pageY + y + "px";
        window.b2thistip[i].style.left = e.pageX + x + "px";
        window.b2thistip[i].style.display = "block";
      },
      passiveSupported ? { passive: true } : false,
    );
    d[i].addEventListener(
      "mouseout",
      function (e) {
        if (typeof window.b2thistip[i] != "undefined") window.b2thistip[i].remove();
      },
      passiveSupported ? { passive: true } : false,
    );
    d[i].addEventListener(
      "mousemove",
      function (e) {
        window.b2thistip[i].style.top = e.pageY + y + "px";
        window.b2thistip[i].style.left = e.pageX + x + "px";
      },
      passiveSupported ? { passive: true } : false,
    );
  }
}
b2tooltip(".b2tooltipbox");
function b2cpay() {
  const paybox = document.querySelectorAll(".custom-pay-box");
  if (paybox.length > 0) {
    for (let i = 0; i < paybox.length; i++) {
      new Vue({
        el: paybox[i],
        data: {
          locked: {},
          count: {},
          files: {},
          progress: {},
          related: false,
          related_field: "",
          related_prices: [],
          active_time: { active: false, tips: "" },
          price: "",
          api: "getCpayResout",
          selecter: "cpay-resout-list-in",
          list: { pages: 0, paged: 1, count: 20, id: 0, data: "" },
          allow: 0,
          tab: "form",
        },
        mounted() {
          if (this.$refs.pickprice) {
            this.price = this.$refs.pickprice.getAttribute("data-price");
          }
          if (this.$refs.cpayresout) {
            this.list.id = this.$refs.cpayresout.getAttribute("data-id");
            this.$refs.reslist.go(this.list.paged, "comment", true, true);
          }
          this.getCpayInfo();
        },
        watch: {
          related_field: function (val) {
            this.price = this.related_prices[val];
          },
        },
        methods: {
          getCpayInfo() {
            this.$http
              .post(b2_rest_url + "getCpayInfo", "post_id=" + b2_global.post_id)
              .then((res) => {
                if (res.data.related === true) {
                  this.related = true;
                  this.related_field = res.data.related_field_value;
                  this.related_prices = res.data.related_prices;
                }
                this.active_time = res.data.active_time;
              })
              .catch((err) => {
                Qmsg["warning"](err.response.data.message, { html: true });
              });
          },
          getList(res) {
            this.list.data = res.data;
            this.allow = res.allow;
            this.list.pages = res.pages;
          },
          submit(title, id, postid) {
            let obj = {};
            let data = new FormData(this.$refs.form);
            for (let [key, value] of data) {
              if (obj[key] !== undefined) {
                if (!Array.isArray(obj[key])) {
                  obj[key] = [obj[key]];
                }
                obj[key].push(value);
              } else {
                obj[key] = value;
              }
              if (typeof obj[key] == "object") {
                if (obj[key].lastModified) {
                  delete obj[key];
                }
              }
              if (this.files.hasOwnProperty(key)) {
                obj[key] = this.files[key];
              }
              if (this.$refs[key + "required"]) {
                let required = this.$refs[key + "required"].getAttribute("data-required");
                required = parseInt(required);
                if (required && (!obj[key] || (Array.isArray(obj[key]) && obj[key].length == 0))) {
                  Qmsg["warning"](b2_global.js_text.global.cpay_required_fields, { html: true });
                  return;
                }
              }
            }
            if (!obj.price) {
              Qmsg["warning"](b2_global.js_text.global.cpay_required_fields, { html: true });
              return;
            }
            b2DsBox.data = {
              title: title,
              order_type: "custom",
              order_price: obj.price,
              post_id: id,
              order_key: postid,
              order_value: JSON.stringify(obj),
            };
            b2DsBox.show = true;
            console.log(b2DsBox.data);
            return obj;
          },
          deleteAc(key, index) {
            if (confirm(b2_global.js_text.circle.remove_file)) {
              this.$delete(this.files[key], index);
              this.$delete(this.progress[key], index);
              this.locked[key] = false;
              this.$set(this.count, key, this.count[key] - 1);
            }
          },
          fileExists(mime) {
            let index = mime.lastIndexOf(".");
            let ext = mime.substr(index + 1);
            return ext.toLowerCase();
          },
          readablizeBytes(bytes) {
            let s = ["B", "KB", "MB", "GB", "TB", "PB"];
            let e = Math.floor(Math.log(bytes) / Math.log(1024));
            return (bytes / Math.pow(1024, Math.floor(e))).toFixed(2) + " " + s[e];
          },
          fileType(ext) {
            ext = ext.toLowerCase();
            switch (ext) {
              case "jpg":
              case "png":
              case "gif":
              case "jpeg":
              case "ico":
              case "webp":
                return "image";
              case "mp3":
              case "m4a":
              case "ogg":
              case "wav":
                return "video";
              case "mp4":
              case "mov":
              case "avi":
              case "mpg":
              case "ogv":
              case "3gp":
              case "3g2":
                return "audio";
              default:
                return "file";
            }
          },
          fileChange(event, count, key, id) {
            if (event.target.files.length > count) {
              let msg = b2_global.js_text.global.cpay_file_count;
              msg = msg.replace("${count}", count);
              Qmsg["warning"](msg, { html: true });
              return;
            }
            if (event.target.files.length <= 0) return;
            if (!this.files.hasOwnProperty(key)) {
              this.$set(this.files, key, []);
              this.$set(this.progress, key, []);
              this.$set(this.locked, key, []);
              this.$set(this.count, key, 0);
            }
            if (event.target.files.length > count - this.count[key]) {
              let msg = b2_global.js_text.global.cpay_file_count_less;
              msg = msg.replace("${count}", count - this.count[key]);
              Qmsg["warning"](msg, { html: true });
              return;
            }
            if (this.locked[key] == true) return;
            let index = parseInt(this.files[key].length);
            Object.keys(event.target.files).forEach((k) => {
              console.log(k);
              this.$set(this.count, key, this.count[key] + 1);
              this.locked[key] = true;
              k = parseInt(k);
              const ext = this.fileExists(event.target.files[k].name);
              this.$set(this.files[key], k + index, {
                size: this.readablizeBytes(event.target.files[k].size),
                name: event.target.files[k].name,
                ext: ext,
                type: this.fileType(ext),
              });
              this.$set(this.progress[key], k + index, { status: "doing", number: 0, msg: "" });
              let formData = new FormData();
              formData.append("file", event.target.files[k], event.target.files[k].name);
              formData.append("post_id", id);
              formData.append("type", "cpay");
              let config = {
                onUploadProgress: (progressEvent) => {
                  this.$set(
                    this.progress[key][k + index],
                    "number",
                    ((progressEvent.loaded / progressEvent.total) * 100) | 0,
                  );
                },
              };
              this.$http
                .post(b2_rest_url + "fileUpload", formData, config)
                .then((res) => {
                  console.log(res);
                  if (res.data.status == 401) {
                    Qmsg["warning"](res.data.message, { html: true });
                    this.$set(this.progress[key][k + index], "status", "fail");
                    this.$set(this.progress[key][k + index], "msg", res.data.message);
                  } else {
                    this.$set(this.files[key][k + index], "url", res.data.url);
                    this.$set(this.files[key][k + index], "id", res.data.id);
                    this.$set(this.progress[key][k + index], "status", "success");
                  }
                  console.log(this.files);
                  if (this.count[key] >= count) {
                    this.locked[key] = true;
                  } else {
                    this.locked[key] = false;
                  }
                  event.target.value = "";
                })
                .catch((err) => {
                  Qmsg["warning"](err.response.data.message, { html: true });
                  this.locked[key] = false;
                  this.$set(this.progress[key][k + index], "status", "fail");
                  this.$set(this.progress[key][k + index], "msg", err.response.data.message);
                  event.target.value = "";
                });
            });
          },
        },
      });
    }
  }
}
b2cpay();
function b2fingerprint() {
  var canvas = document.createElement("canvas");
  var ctx = canvas.getContext("2d");
  var txt = "i9asdm..$#po((^@KbXrww!~cz";
  ctx.textBaseline = "top";
  ctx.font = "16px 'Arial'";
  ctx.textBaseline = "alphabetic";
  ctx.rotate(0.05);
  ctx.fillStyle = "#f60";
  ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = "#069";
  ctx.fillText(txt, 2, 15);
  ctx.fillStyle = "rgba(102, 200, 0, 0.7)";
  ctx.fillText(txt, 4, 17);
  ctx.shadowBlur = 10;
  ctx.shadowColor = "blue";
  ctx.fillRect(-20, 10, 234, 5);
  var strng = canvas.toDataURL();
  var hash = 0;
  if (strng.length == 0) return;
  for (i = 0; i < strng.length; i++) {
    char = strng.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash;
}
var b2stream = new Vue({
  el: "#b2-stream",
  data: { paged: 1, pages: 0, author: 1, data: "", empty: false, locked: false },
  mounted() {
    if (!this.$refs.b2stream) return;
    this.paged = this.$refs.b2stream.getAttribute("data-paged");
    this.author = this.$refs.b2stream.getAttribute("data-author");
    this.getList();
  },
  methods: {
    getList() {
      this.$http.post(b2_rest_url + "getStreamList", "paged=" + this.paged + "&author=" + this.author).then((res) => {
        this.data = res.data;
        if (this.data.length == 0) {
          this.empty = true;
        }
        this.$refs.gujia.style.display = "none";
        this.$nextTick(() => {
          b2SidebarSticky();
          lazyLoadInstance.update();
        });
      });
    },
    vote(type, id, index) {
      if (!b2token) {
        login.show = true;
      } else {
        if (this.locked == true) return;
        this.locked = true;
        this.$http
          .post(b2_rest_url + "postVote", "type=" + type + "&post_id=" + id)
          .then((res) => {
            this.$set(
              this.data[index].data.data,
              "up",
              parseInt(this.data[index].data.data.up) + parseInt(res.data.up),
            );
            this.$set(
              this.data[index].data.data,
              "down",
              parseInt(this.data[index].data.data.down) + parseInt(res.data.down),
            );
            if (res.data.up > 0) {
              this.$set(this.data[index].data.data, "up_isset", 1);
            } else {
              this.$set(this.data[index].data.data, "up_isset", 0);
            }
            if (res.data.down > 0) {
              this.$set(this.data[index].data.data, "down_isset", 1);
            } else {
              this.$set(this.data[index].data.data, "down_isset", 0);
            }
            this.locked = false;
          })
          .catch((err) => {
            Qmsg["warning"](err.response.data.message, { html: true });
            this.locked = false;
          });
      }
    },
  },
});
function _debounce(fn, delay) {
  var delay = delay || 200;
  var timer;
  return function () {
    var th = this;
    var args = arguments;
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(function () {
      timer = null;
      fn.apply(th, args);
    }, delay);
  };
}
function _throttle(fn, interval) {
  var last;
  var timer;
  var interval = interval || 200;
  return function () {
    var th = this;
    var args = arguments;
    var now = +new Date();
    if (last && now - last < interval) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        last = now;
        fn.apply(th, args);
      }, interval);
    } else {
      last = now;
      fn.apply(th, args);
    }
  };
}
var askWidget = new Vue({
  el: ".b2-widget-ask",
  data: {
    data: "",
    fliter: "last",
    paged: 1,
    pages: 0,
    count: 0,
    cat: 0,
    empty: false,
    locked: false,
    prev: true,
    next: false,
  },
  mounted() {
    if (!this.$refs.askwidget) return;
    this.count = this.$refs.askwidget.getAttribute("data-count");
    this.time = this.$refs.askwidget.getAttribute("data-time");
    const archive = document.querySelector(".ask-archive");
    if (archive) {
      this.cat = archive.getAttribute("data-term");
    }
    const single = document.querySelector(".ask-single-top");
    if (single) {
      this.cat = single.getAttribute("data-term");
    }
    this.getData();
  },
  watch: {
    fliter(val) {
      this.prev = true;
      this.next = false;
      this.data = "";
      this.paged = 1;
      this.empty = false;
      this.$refs.askwidget.querySelector(".gujia").style.display = "block";
      this.getData();
    },
  },
  methods: {
    nexAc() {
      if (this.paged >= this.data.pages) return;
      if (this.locked) return;
      this.next = true;
      this.paged++;
      this.getData();
    },
    prevAc() {
      if (this.paged < 1) return;
      if (this.locked) return;
      this.prev = true;
      this.paged--;
      this.getData();
    },
    getData() {
      if (this.locked) return;
      this.locked = true;
      this.$http
        .post(
          b2_rest_url + "getAskData",
          "paged=" + this.paged + "&type=" + this.fliter + "&count=" + this.count + "&cat=" + this.cat,
        )
        .then((res) => {
          this.locked = false;
          if (this.paged == 1) {
            if (res.data.data.length == 0) {
              this.empty = true;
              this.data.data = [];
            } else {
              this.data = res.data;
            }
          } else {
            this.data.data = res.data.data;
          }
          if (this.data.pages > 1 && this.paged < this.data.pages) {
            this.next = false;
          }
          if (this.paged > 1) {
            this.prev = false;
          }
          this.$nextTick(() => {
            this.$refs.askwidget.querySelector(".gujia").style.display = "none";
          });
        });
    },
  },
});
