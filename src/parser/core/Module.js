export const DISPLAY_ORDER = {
	ABOUT: -3,
	CHECKLIST: -2,
	SUGGESTIONS: -1,
	TOP: 0,
	DEFAULT: 50,
	BOTTOM: 100,
}

export default class Module {
	static dependencies = []
	static displayOrder = DISPLAY_ORDER.DEFAULT

	static _handle
	static get handle() {
		if (!this._handle) {
			const handle = this.name.charAt(0).toLowerCase() + this.name.slice(1)
			console.error(`\`${this.name}\` does not have an explicitly set handle. Using \`${handle}\`. This WILL break in minified builds.`)
			this._handle = handle
		}
		return this._handle
	}
	static set handle(value) {
		this._handle = value
	}

	static _title = null
	static get title() {
		if (!this._title) {
			this._title = this.handle.charAt(0).toUpperCase() + this.handle.slice(1)
		}
		return this._title
	}
	static set title(value) {
		this._title = value
	}

	set name(value) {
		console.warn(`\`${this.constructor.handle}\` is setting the display title via the \`name\` instance property. Use \`static title\` instead.`)
		this.constructor.title = value
	}

	_hooks = new Map()

	constructor(parser) {
		this.parser = parser
		this.constructor.dependencies.forEach(dep => {
			this[dep] = parser.modules[dep]
		})

		// Backwards compat for the old event magic mehods
		// TODO: Remove before final live
		// Get a list of all the properties on this entire object's prototype chain
		const props = new Set()
		for (let obj = new.target.prototype; obj !== Object.prototype; obj = Object.getPrototypeOf(obj)) {
			Object.getOwnPropertyNames(obj).forEach(name => {
				props.add(name)
			})
		}

		// Check for any functions in there that match the old magic method names and connect them to the new hooks
		const exp = /on_([^_]+)(?:_(by|to)Player(Pet)?)?/
		props.forEach(name => {
			const match = exp.exec(name)
			if (!match) { return }

			const filter = {}
			let entity = 'player'

			if (match[3]) {
				entity = 'pet'
			}
			if (match[2]) {
				filter[match[2]] = entity
			}

			console.warn(`The \`${this.constructor.handle}\` module is using the old-style event hook \`${name}\`. Please update it to use the new \`addHook\` function.`)

			this.addHook(match[1], filter, this[name].bind(this))
		})
	}

	normalise(events) {
		return events
	}

	addHook(events, filter, cb) {
		const mapFilterEntity = (qol, raw) => {
			if (filter[qol]) {
				switch (filter[qol]) {
				case 'player':
					filter[raw] = this.parser.player.id
					break
				case 'pet':
					filter[raw] = this.parser.player.pets.map(pet => pet.id)
					break
				default:
					filter[raw] = filter[qol]
				}
				delete filter[qol]
			}
		}

		// I'm currently handling hooks at the module level
		// Should performance become a concern, this can be moved up to the Parser without breaking the API
		if (typeof filter === 'function') {
			cb = filter
			filter = {}
		}

		// QoL filter transforms
		mapFilterEntity('to', 'targetID')
		mapFilterEntity('by', 'sourceID')
		if (filter.abilityId) {
			if (!filter.ability) {
				filter.ability = {}
			}
			filter.ability.guid = filter.abilityId
			delete filter.abilityId
		}
		const hook = {
			events,
			filter,
			callback: cb.bind(this),
		}

		// Make sure events is an array
		if (!Array.isArray(events)) {
			events = [events]
		}

		// Hook for each of the events
		events.forEach(event => {
			// Make sure the map has a key for us
			if (!this._hooks.has(event)) {
				this._hooks.set(event, new Set())
			}

			// Set the hook
			this._hooks.get(event).add(hook)
		})

		// Return the hook representation so it can be removed (later)
		return hook
	}

	triggerEvent(event) {
		// Run through registered hooks. Avoid calling 'all' on symbols, they're internal stuff.
		if (typeof event.type !== 'symbol') {
			this._runHooks(event, this._hooks.get('all'))
		}
		this._runHooks(event, this._hooks.get(event.type))
	}

	_runHooks(event, hooks) {
		if (!hooks) { return }
		hooks.forEach(hook => {
			// Check the filter
			if (!this._filterMatches(event, hook.filter)) {
				return
			}

			hook.callback(event)
		})
	}

	_filterMatches(event, filter) {
		return Object.keys(filter).every(key => {
			// If the event doesn't have the key we're looking for, just shortcut out
			if (!event.hasOwnProperty(key)) {
				return false
			}

			const filterVal = filter[key]
			const eventVal = event[key]

			// FFLogs doesn't use arrays inside events themselves, so I'm using them to handle multiple possible values
			if (Array.isArray(filterVal)) {
				return filterVal.includes(eventVal)
			}

			// If it's an object, I need to dig down. Mostly for the `ability` key
			if (typeof filterVal === 'object') {
				return this._filterMatches(eventVal, filterVal)
			}

			// Basic value check
			return filterVal === eventVal
		})
	}

	output() {
		return false
	}
}
