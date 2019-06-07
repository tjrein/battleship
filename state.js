/*
---------------------------------------------------------------------------------
  Name: state.js

  Purpose:
    This file contains functions related to state validation.
    It parses messages from the client and server and returns valid command + parameters, or null otherwise

  Date: 06/07/2019

  Author: Tom Rein
--------------------------------------------------------------------------------
*/


//This function parses messages into commands and parameters.
//If a message contains ':' character, all following characters are treated as one parameter.
//Otherwise, messages are split according to the space character into an array.
//The command will be the first element and all subsequent elements will be parameters/
function parseMessage(message) {
  //declare variable to break up message into command and parameters
  let components;

  //process escpaed whitespace
  if (message.includes(':')) {
    let ind = message.indexOf(':');
    let esc_param = message.slice(ind + 1, message.length);
    let upto_esc = message.slice(0, ind - 1);
    components = upto_esc.split(" ");
    components.push(esc_param);
  } else {
    //split on space.
    components = message.split(" ");
  }

  let command = components[0];
  let params = components.splice(1, components.length - 1);
  return {command: command, params: params}
}

//STATEFUL
//The state map is a dictionary of all states as keys and allowable commands as values.
//this checks that a given state is in the state map, and that the given command is in the array of allowable commands.
function validate_state(command, current_state, state_map) {
  return state_map[current_state] && state_map[current_state].includes(command);
}

//STATEFUL
//This function is the main state validaiton function.
//parses a message into command and parameters
//checks the command is in accordance with the state_map
//returns the command and params if allowable, or null otherwise
function validate_message_with_state(message, current_state, state_map) {
  let {command, params} = parseMessage(message);
  let is_allowable = validate_state(command, current_state, state_map);
  if (is_allowable) {
    return [command, params];
  } else {
    return null;
  }
}

//export function so it can be imported by client and server
module.exports.validate_message_with_state = validate_message_with_state;
