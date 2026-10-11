  class CapabilityEngine {
    static get registry() { return AcCapabilityRegistry; }
    static get BRAND_PROTOCOL_LIMITS() { return Object.fromEntries(Object.keys(AcCapabilityRegistry.data.protocols).map(p=>[p.toLowerCase(),this.getCapabilities(p)])); }
    static resolveProtocolName(value) { return AcCapabilityRegistry.protocol(value); }
    static getCapabilities(value,mode) { return AcCapabilityRegistry.capabilities(value,mode); }
    static isSupported(value,feature,selected=null) {
      const caps=this.getCapabilities(value);
      if(!caps.can_transmit)return false;
      const name=String(feature||'').toLowerCase();
      if(name==='temp'||name==='temperature')return caps.temperature_controllable && (selected===null || AcCapabilityRegistry.validateTemperature(value,selected).valid);
      if(name==='mode')return selected===null?caps.modes.length>0:caps.modes.includes(String(selected).toLowerCase());
      if(name==='fan')return selected===null?caps.fans.length>0:caps.fans.includes(String(selected).toLowerCase()) && (!AcCapabilityRegistry.range(value,value?.state?.mode)?.fixed_fan || selected===AcCapabilityRegistry.range(value,value?.state?.mode).fixed_fan);
      return caps[name==='swing'?'swing_vertical':name]===true;
    }
    static clampTemperature(value,temp) {
      const result=AcCapabilityRegistry.validateTemperature(value,temp);
      if(!result.valid)throw new Error(result.message);
      return temp; // Kept for older callers; invalid values are reported, never silently clamped.
    }
    static getSupportedProtocols() { return Object.keys(AcCapabilityRegistry.data.protocols).map(p=>this.getCapabilities(p)); }
    static async verify(deviceId,profile,revision) {
      const device=AirconProfileManager.getById(deviceId),sb=window.supabaseClient||window.sb;
      if(!device?.aircon_id||!sb)throw new Error('Choose a registered AC first.');
      const response=await sb.rpc('ecotrack_verify_ac_capabilities',{p_aircon_id:device.aircon_id,p_expected_revision:revision||0,p_profile:profile});
      if(response.error)throw new Error(response.error.message);
      await syncWithDatabase();
      return response.data;
    }
  }
