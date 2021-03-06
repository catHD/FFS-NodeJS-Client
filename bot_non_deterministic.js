// Dependencies.

var request = require( 'request' ),
	config = require( './config.js' ),
	Q = require( 'q' ),
	log = require( './vendor/log.js' ),
	api = require( './vendor/api.js' ),
	pu = require( './vendor/printUtils.js' ),
	Constants = require( './vendor/constants.js' ),
	io = require( 'socket.io-client' ),
	readline = require( 'readline' );

// Exit handlers.

process.on( 'SIGINT', function ()
{
	process.exit( -1 );
} );

/*
process.on( 'exit', function ()
{
	socket.disconnect();
} );
*/

// Defers.

var defers = {
	name: Q.defer(), // Resolved when user has chosen his name.
	prematch: Q.defer(), // Resolved when user has chosen his team and has to wait for the other player.
	otherPlayerPrematchReady: Q.defer(), // Resolved when the other user has chosen his team.
	matchReady: Q.defer(), // Resolved when match is ready.
	startMatch: Q.defer() // Resolved when match has started.
};

// Functions.

var critical_error = function ( error, area )
{
	log.error( error, area );
	process.exit( -1 );
};

// Settings.

var baseURL = config.baseURL + ':' + config.port;

var me = {
	id: null,
	team: null,
	name: null
};

var he = {
	id: null,
	team: null,
	name: null
};

var currently_in_decision_phase = false;

// Socket.

var socket = io.connect( baseURL );

socket.on( 'disconnect', function ( data )
{
	critical_error( data, 'DISCONNECT' );
} );

var login = function ()
{
	var defer_username = Q.defer();
	var defer_password = Q.defer();

	var username = null;
	var password = null;

	log.input( 'Logging in...', 'LOGIN' );

	username = "Lluís";
	password = "yolo";

	me.name = username;

	socket.emit( Constants.LOGIN_EVENT,
	{
		username: username,
		password: password
	} );
};

var choose_team = function ( id )
{
	// @TODO Query teams for current user.
	// @TODO Request the list of teams only once.
	request( baseURL + '/player/' + id + '/teams', function ( err, res )
	{
		if ( err ) critical_error( err );
		var teams = JSON.parse( res.body );
		api.loadTeams( teams ).then( function ()
		{
			me.team = teams[ Math.floor( Math.random() * teams.length ) ];
			socket.emit( Constants.CHOOSE_TEAM_EVENT, me.team.id );
			log.info( "Chosen team 0", "TEAM" );
		} ); // All characters ready.
	} ); // Teams request.
};

socket.on( Constants.WELCOME_EVENT, function ()
{
	// I'm connected to server so I have to login.
	login();
} );

socket.on( Constants.LOGIN_FAILED_EVENT, function ()
{
	log.error( "Error when logging in", "LOGIN" );
	process.exit( -1 );
} );

socket.on( Constants.LOGIN_SUCCEED_EVENT, function ( data )
{
	log.success( 'Logged in!', 'LOGIN' );
	choose_team( data.id );
} );

socket.on( Constants.INVALID_TEAM_EVENT, function ()
{
	log.error( "Error when choosing team", "TEAM" );
	process.exit( -1 );
} );

socket.on( Constants.VALID_TEAM_EVENT, function ()
{
	log.info( 'Server is looking for a proper rival...', 'WAIT' );
} );

socket.on( Constants.MATCH_FOUND_EVENT, function ()
{
	log.info( 'A rival has been found!', 'WAIT' );
} );

socket.on( Constants.SEND_RIVAL_INFO_EVENT, function ( environment )
{
	var rival = environment.rival;
	he.name = rival.name;
	he.team = rival.team;
	me.team = environment.team;

	var assign_class = function ( _c )
	{
		return function ( _class )
		{
			me.team.characters[ _c ].class = _class;
		};
	};

	var promises = [];
	for ( var _c in me.team.characters )
	{
		var defer = Q.defer();
		defer.promise.then( assign_class( _c ) );
		promises.push( defer.promise );
		api.loadClass( me.team.characters[ _c ].class ).then( defer.resolve );
	}

	Q.all( promises ).then( function ()
	{
		// Client should wait for complete initialization.
	} );
} );

var decision_phase = function ()
{
	currently_in_decision_phase = true;

	pu.printBattleScenario(
	{
		me: me,
		he: he
	} );

	var selections = [];

	var selection_promises = [];

	var questions_to_ask = [];

	var behaviour = 0;

	var ask_selection_question = function ( _c )
	{
		var c = me.team.characters[ _c ];
		if ( c.alive )
		{

			var minimum, maximum, alive = 0;
			for ( var j in he.team.characters )
			{
				if ( he.team.characters[ j ].stats[ Constants.HEALTH_STAT_ID ] > 0 ) alive++;
				if ( minimum === undefined )
				{
					minimum = {
						character: he.team.characters[ j ],
						value: he.team.characters[ j ].stats[ Constants.HEALTH_STAT_ID ]
					};
				}
				if ( ( minimum.value <= 0 || minimum.value > he.team.characters[ j ].stats[ Constants.HEALTH_STAT_ID ] ) && he.team.characters[ j ].stats[ Constants.HEALTH_STAT_ID ] > 0 )
				{
					minimum = {
						character: he.team.characters[ j ],
						value: he.team.characters[ j ].stats[ Constants.HEALTH_STAT_ID ]
					};
				}
				if ( maximum === undefined )
				{
					maximum = {
						character: he.team.characters[ j ],
						value: he.team.characters[ j ].stats[ Constants.HEALTH_STAT_ID ]
					};
				}
				if ( maximum.value > he.team.characters[ j ].stats[ Constants.HEALTH_STAT_ID ] )
				{
					maximum = {
						character: he.team.characters[ j ],
						value: he.team.characters[ j ].stats[ Constants.HEALTH_STAT_ID ]
					};
				}
			}

			var r = Math.random();

			if ( behaviour === 0 && r * alive > 0.5 ) behaviour = 1;
			else if ( behaviour === 0 ) behaviour = 2;
			else if ( alive > 2 ) behaviour = ( r > 0.5 ) ? 3 : 0;
			else behaviour = 0;

			switch ( behaviour )
			{
			case 1:

				log.info( c.name + ' will paralyze', 'CHARACTER' );
				selections[ _c ] = {
					character: me.team.characters[ _c ].id,
					skill: me.team.characters[ _c ].class.skills[ 5 ].id,
					targets: [ maximum.character.id ]
				};
				break;

			case 2:

				log.info( c.name + ' will poison', 'CHARACTER' );
				selections[ _c ] = {
					character: me.team.characters[ _c ].id,
					skill: me.team.characters[ _c ].class.skills[ 1 ].id,
					targets: [ maximum.character.id ]
				};
				break;

			case 3:

				log.info( c.name + ' will use nova', 'CHARACTER' );
				selections[ _c ] = {
					character: me.team.characters[ _c ].id,
					skill: me.team.characters[ _c ].class.skills[ 4 ].id,
					targets: []
				};
				for ( var _i in he.team.characters )
					selections[ _c ].targets.push( he.team.characters[ _i ].id );
				break;

			case 4:

				log.info( c.name + ' will use esuna', 'CHARACTER' );
				selections[ _c ] = {
					character: me.team.characters[ _c ].id,
					skill: me.team.characters[ _c ].class.skills[ 2 ].id,
					targets: [ me.team.characters[ _c ].id ]
				};
				break;

			default:
				log.info( c.name + ' will attack', 'CHARACTER' );
				selections[ _c ] = {
					character: me.team.characters[ _c ].id,
					skill: me.team.characters[ _c ].class.skills[ 0 ].id,
					targets: [ minimum.character.id ]
				};
				break;
			}
		}

	};

	for ( var _c in me.team.characters )
		ask_selection_question( _c );

	if ( currently_in_decision_phase )
	{
		currently_in_decision_phase = false;
		log.info( 'Wait for the other player...', 'WAIT' );
		socket.emit( Constants.DECISION_MADE_EVENT, selections );
	}
	else
	{
		log.warn( 'A timeout happened!' );
	}
};

socket.on( Constants.DECISIONS_PHASE_END_EVENT, function ()
{
	currently_in_decision_phase = false;
	log.info( 'Decisions phase ended!' );
} );

socket.on( Constants.ROUND_RESULTS_EVENT, function ( decisions )
{

	for ( var i in decisions )
	{
		var d = decisions[ i ];
		var changes = d.changes;

		for ( var c in changes )
		{
			var change = changes[ c ];

			var player_affected = he;
			for ( var j in me.team.characters )
				if ( me.team.characters[ j ].id === change.character.id ) player_affected = me;

			var player_user = ( player_affected === he ) ? me : he;

			for ( j in player_affected.team.characters )
			{

				if ( player_affected.team.characters[ j ].id === change.character.id )
				{
					if ( change.item.key === "stat" )
					{
						player_affected.team.characters[ j ].stats[ change.item.value ] += parseInt( change.change );
						log.status( player_user.name + ' ordered ' + d.skill.caller.name + ' to use ' + d.skill.name + ' against ' + player_affected.team.characters[ j ].name + ', dealing ' + change.change + ' damage points', 'BATTLE' );
					}
					else if ( change.item.key === "status" )
					{
						if ( change.change === "+" )
							log.status( player_user.name + ' ordered ' + d.skill.caller.name + ' to use ' + d.skill.name + ' against ' + player_affected.team.characters[ j ].name + ', ' + change.item.value + 'ing him', 'BATTLE' );
						else
							log.status( player_user.name + ' ordered ' + d.skill.caller.name + ' to use ' + d.skill.name + ' against ' + player_affected.team.characters[ j ].name + ', healing his ' + change.item.value + 'ing', 'BATTLE' );
					}
					break;
				}
			}
		}
	}

} );

socket.on( Constants.DECISIONS_PHASE_START_EVENT, function ()
{
	decision_phase();
} );

socket.on( Constants.WIN_EVENT, function ()
{
	log.success( 'YOU WIN', 'GZ' );
	process.exit( 0 );
} );

socket.on( Constants.LOSE_EVENT, function ()
{
	log.error( 'Y0U L0S3', 'N00B' );
	process.exit( 0 );
} );