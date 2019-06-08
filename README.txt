=====BATTLESHIP Protocol======
  Author: Tom Rein
  Email: tr557@drexel.edu

====Dependencies====
  Node v8.10.0

====Usage Instructions====

  *Server*
    To start the server type "node server.js"

  *Client*
    To connect a client to the server type "node client.js"
    This is configured to run locally by default.
    However an ipaddress can be specified in the following manner "node client host=192.168.1.3"
    One can also specify a hostname in the same manner, however this will depend on that host having an entry in /etc/hosts (this is discussed in requirements)

  *Logging in*
    There are two users available: foo and bar.
    Both passwords are "password".
    The user entries are located in ./config.josn

  *Configuration*
    There is a configuration file where additional options can be added to the game.
    The default configuration has a 3x3 grid and one ship that can be placed.
    The grid size can be modified, provided you enter appropriate grid positions in the guess_map.
    Additional ships can also be added, and require entries in "ships" and "ships_by_id"
    This file does not have any comments since it is a JSON file. Comments are not allowed.

  *Interface*
    The protocol interface responds to numerical inputs that correspond to commands.
    There will be a list of available options at the prompt. To execute an option, type the corresponding number.
    Some options require parameters, and an additional prompt will ask for them. If there are multiple parameters, it is expected that this

  *Operating Systems*
    It is advisable that this be run on Linux.
    I was able to run the protocol on Tux by specifying the ipaddress that the server was running on.
    Tux has Node v8.10.0 installed


=====Protocol Analysis====
  In general I think my protocol is relatively robust for what it is.
  It is able to handle mistyped inputs and I do a fair amount of error checking for things such as placing ships.
  I validate the state of each message to make sure that the command can be executed in accordance with the state.

  However, there are limitations in that the protocol is plain text protocol, and thus messages are easy to fuzz.
  I think the client-to-server messages are robust because they are all unique, however, I think there are issues with my server-to-client messages.
  I use a general purpose OK message, which transitions the state depending on what command the client entered.
  The problem with this is that if someone could simulate the server and send an OK message, it seems like they could mess up the state.
  I only thought of this issue late in the implementation, otherwise I would have corrected it.
  If I were to do things differently, I would have each confirmation message be their own unique message. I think this would make things more robust.
  However, if I was truly concerned about robustness, I would not use a plaintext message protocol to begin with. As this is extremely insecure.

  To test the robustness of my protocol. I attempted to execute commands outside of the state. I did this by exposing inputs on the interface that would otherwise not be there.
  I also tested parsing multiple messages in a stream. I parse messages by splitting the data recieved on a newline which returns an array.
  Therefore, I tested an array of multiple messages, that would not be valid according to the DFA. For example, sending a BEGIN message after a USER message.
  My state validation was able to handle these cases.

====Extra Credit====
I did not implement extra credit.
