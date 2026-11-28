/** Compatibility bridge for the preserved detailed-verification module. */
function props_(){return PropertiesService.getScriptProperties();}
function authorize_(){return adminAllowed_();}
function withLock_(fn){return v2AdminLock_(fn);}
function hash_(value){return v2Hash_(value);}
function iso_(value){return (value instanceof Date?value:(value?new Date(value):new Date())).toISOString();}
function day_(value){return v2JstDate_(value instanceof Date?value:new Date(value));}
function cell_(value){return value instanceof Date?value.toISOString():value===undefined||value===null?'':value;}
