(function () {
  const Patcher = vendetta.patcher;
  const PluginStorage = vendetta.plugin.storage;
  const PluginLogger = vendetta.logger;
  const ReactRuntime = vendetta.metro.common.React;
  const StorageHooks = vendetta.storage;
  const { Forms, General } = vendetta.ui.components;
  const { FormSection, FormSwitchRow, FormText } = Forms;
  const { ScrollView } = General;

  const GatewayIdentifyOpcode = 2;
  const SuperPropertiesHeaderName = "x-super-properties";
  const SpoofLogTag = "[WindowsDesktopSpoof]";

  const AndroidOnlyPropertyNames = [
    "device_vendor_id",
    "design_id",
    "device_advertiser_id",
    "accessibility_support_enabled",
    "accessibility_features",
    "client_performance_cpu",
    "client_performance_memory",
  ];

  const WindowsDesktopProperties = Object.freeze({
    os: "Windows",
    browser: "Discord Client",
    device: "",
    os_version: "10.0.19045",
    os_arch: "x64",
    app_arch: "x64",
    release_channel: "stable",
  });

  const ActiveUnpatchCallbacks = [];

  function RewriteClientProperties(AndroidProperties) {
    const DesktopProperties = Object.assign({}, AndroidProperties, WindowsDesktopProperties);
    for (const PropertyName of AndroidOnlyPropertyNames) {
      delete DesktopProperties[PropertyName];
    }
    return DesktopProperties;
  }

  function RewriteIdentifyFrame(GatewayFrame) {
    if (typeof GatewayFrame !== "string" || !GatewayFrame.includes('"op":2')) {
      return GatewayFrame;
    }
    try {
      const IdentifyEnvelope = JSON.parse(GatewayFrame);
      const IdentifyBody = IdentifyEnvelope.d;
      if (IdentifyEnvelope.op !== GatewayIdentifyOpcode || !IdentifyBody || !IdentifyBody.properties) {
        return GatewayFrame;
      }
      IdentifyBody.properties = RewriteClientProperties(IdentifyBody.properties);
      return JSON.stringify(IdentifyEnvelope);
    } catch (Failure) {
      PluginLogger.error(SpoofLogTag + " gateway identify rewrite failed", Failure);
      return GatewayFrame;
    }
  }

  function RewriteSuperProperties(EncodedSuperProperties) {
    try {
      const DecodedProperties = JSON.parse(atob(EncodedSuperProperties));
      return btoa(JSON.stringify(RewriteClientProperties(DecodedProperties)));
    } catch (Failure) {
      PluginLogger.error(SpoofLogTag + " super properties rewrite failed", Failure);
      return EncodedSuperProperties;
    }
  }

  function RewriteRequestHeaders(RequestHeaders) {
    if (typeof Headers !== "undefined" && RequestHeaders instanceof Headers) {
      const ClonedHeaders = new Headers(RequestHeaders);
      const ExistingValue = ClonedHeaders.get(SuperPropertiesHeaderName);
      if (ExistingValue) {
        ClonedHeaders.set(SuperPropertiesHeaderName, RewriteSuperProperties(ExistingValue));
      }
      return ClonedHeaders;
    }
    const ClonedHeaders = Object.assign({}, RequestHeaders);
    for (const HeaderName of Object.keys(ClonedHeaders)) {
      if (HeaderName.toLowerCase() === SuperPropertiesHeaderName) {
        ClonedHeaders[HeaderName] = RewriteSuperProperties(ClonedHeaders[HeaderName]);
      }
    }
    return ClonedHeaders;
  }

  function InstallGatewayIdentifyPatch() {
    ActiveUnpatchCallbacks.push(
      Patcher.before("send", WebSocket.prototype, function (SendArguments) {
        const GatewayFrame = SendArguments[0];
        const RewrittenFrame = RewriteIdentifyFrame(GatewayFrame);
        if (RewrittenFrame !== GatewayFrame) {
          return [RewrittenFrame].concat(SendArguments.slice(1));
        }
      })
    );
  }

  function InstallRestHeaderPatches() {
    ActiveUnpatchCallbacks.push(
      Patcher.before("setRequestHeader", XMLHttpRequest.prototype, function (HeaderArguments) {
        const HeaderName = HeaderArguments[0];
        if (typeof HeaderName === "string" && HeaderName.toLowerCase() === SuperPropertiesHeaderName) {
          return [HeaderName, RewriteSuperProperties(HeaderArguments[1])];
        }
      })
    );
    ActiveUnpatchCallbacks.push(
      Patcher.before("fetch", globalThis, function (FetchArguments) {
        const RequestTarget = FetchArguments[0];
        const RequestOptions = FetchArguments[1];
        if (!RequestOptions || !RequestOptions.headers) return;
        return [
          RequestTarget,
          Object.assign({}, RequestOptions, { headers: RewriteRequestHeaders(RequestOptions.headers) }),
        ];
      })
    );
  }

  function ApplyStorageDefaults() {
    if (PluginStorage.SpoofGatewayIdentify === undefined) PluginStorage.SpoofGatewayIdentify = true;
    if (PluginStorage.SpoofRestHeaders === undefined) PluginStorage.SpoofRestHeaders = true;
  }

  function WindowsDesktopSpoofSettings() {
    StorageHooks.useProxy(PluginStorage);
    return ReactRuntime.createElement(
      ScrollView,
      null,
      ReactRuntime.createElement(
        FormSection,
        { title: "Spoofing targets", titleStyleType: "no_border" },
        ReactRuntime.createElement(FormSwitchRow, {
          label: "Gateway identify",
          subLabel: "Presents the session as Windows desktop when connecting",
          value: PluginStorage.SpoofGatewayIdentify,
          onValueChange: function (Enabled) {
            PluginStorage.SpoofGatewayIdentify = Enabled;
          },
        }),
        ReactRuntime.createElement(FormSwitchRow, {
          label: "REST request headers",
          subLabel: "Rewrites X-Super-Properties on API requests",
          value: PluginStorage.SpoofRestHeaders,
          onValueChange: function (Enabled) {
            PluginStorage.SpoofRestHeaders = Enabled;
          },
        })
      ),
      ReactRuntime.createElement(
        FormText,
        null,
        "Changes apply on the next gateway connection. Fully restart Discord after toggling."
      )
    );
  }

  return {
    onLoad: function () {
      ApplyStorageDefaults();
      if (PluginStorage.SpoofGatewayIdentify) InstallGatewayIdentifyPatch();
      if (PluginStorage.SpoofRestHeaders) InstallRestHeaderPatches();
    },
    onUnload: function () {
      while (ActiveUnpatchCallbacks.length > 0) {
        ActiveUnpatchCallbacks.pop()();
      }
    },
    settings: WindowsDesktopSpoofSettings,
  };
})()
