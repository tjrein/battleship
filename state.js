function validate_state(command, current_state, state_map) {
  return state_map[current_state] && state_map[current_state].includes(command)
}

function parseMessage(message) {
  let components;

  //process escpaed whitespace
  if (message.includes(':')) {
    let ind = message.indexOf(':');
    let esc_param = message.slice(ind + 1, message.length);
    let upto_esc = message.slice(0, ind - 1);
    components = upto_esc.split(" ");
    components.push(esc_param);
  } else {
    components = message.split(" ");
  }

  let command = components[0]
  let params = components.splice(1, components.length - 1)
  return {command: command, params: params}
}

function validate_message_with_state(message, current_state, state_map) {
  let {command, params} = parseMessage(message);
  let is_allowable = validate_state(command, current_state, state_map);
  if (is_allowable) {
    return [command, params];
  } else {
    return null;
  }
}

module.exports.validate_message_with_state = validate_message_with_state;
