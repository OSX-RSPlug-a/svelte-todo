
(function(l, r) { if (l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (window.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.head.appendChild(r) })(window.document);
var app = (function () {
    'use strict';

    function noop() { }
    const identity = x => x;
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }

    const is_client = typeof window !== 'undefined';
    let now = is_client
        ? () => window.performance.now()
        : () => Date.now();
    let raf = is_client ? cb => requestAnimationFrame(cb) : noop;

    const tasks = new Set();
    let running = false;
    function run_tasks() {
        tasks.forEach(task => {
            if (!task[0](now())) {
                tasks.delete(task);
                task[1]();
            }
        });
        running = tasks.size > 0;
        if (running)
            raf(run_tasks);
    }
    function loop(fn) {
        let task;
        if (!running) {
            running = true;
            raf(run_tasks);
        }
        return {
            promise: new Promise(fulfil => {
                tasks.add(task = [fn, fulfil]);
            }),
            abort() {
                tasks.delete(task);
            }
        };
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_input_value(input, value) {
        if (value != null || input.value) {
            input.value = value;
        }
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let stylesheet;
    let active = 0;
    let current_rules = {};
    // https://github.com/darkskyapp/string-hash/blob/master/index.js
    function hash(str) {
        let hash = 5381;
        let i = str.length;
        while (i--)
            hash = ((hash << 5) - hash) ^ str.charCodeAt(i);
        return hash >>> 0;
    }
    function create_rule(node, a, b, duration, delay, ease, fn, uid = 0) {
        const step = 16.666 / duration;
        let keyframes = '{\n';
        for (let p = 0; p <= 1; p += step) {
            const t = a + (b - a) * ease(p);
            keyframes += p * 100 + `%{${fn(t, 1 - t)}}\n`;
        }
        const rule = keyframes + `100% {${fn(b, 1 - b)}}\n}`;
        const name = `__svelte_${hash(rule)}_${uid}`;
        if (!current_rules[name]) {
            if (!stylesheet) {
                const style = element('style');
                document.head.appendChild(style);
                stylesheet = style.sheet;
            }
            current_rules[name] = true;
            stylesheet.insertRule(`@keyframes ${name} ${rule}`, stylesheet.cssRules.length);
        }
        const animation = node.style.animation || '';
        node.style.animation = `${animation ? `${animation}, ` : ``}${name} ${duration}ms linear ${delay}ms 1 both`;
        active += 1;
        return name;
    }
    function delete_rule(node, name) {
        node.style.animation = (node.style.animation || '')
            .split(', ')
            .filter(name
            ? anim => anim.indexOf(name) < 0 // remove specific animation
            : anim => anim.indexOf('__svelte') === -1 // remove all Svelte animations
        )
            .join(', ');
        if (name && !--active)
            clear_rules();
    }
    function clear_rules() {
        raf(() => {
            if (active)
                return;
            let i = stylesheet.cssRules.length;
            while (i--)
                stylesheet.deleteRule(i);
            current_rules = {};
        });
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function createEventDispatcher() {
        const component = current_component;
        return (type, detail) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail);
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
            }
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function flush() {
        const seen_callbacks = new Set();
        do {
            // first, call beforeUpdate functions
            // and update components
            while (dirty_components.length) {
                const component = dirty_components.shift();
                set_current_component(component);
                update(component.$$);
            }
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    callback();
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
    }
    function update($$) {
        if ($$.fragment) {
            $$.update($$.dirty);
            run_all($$.before_update);
            $$.fragment.p($$.dirty, $$.ctx);
            $$.dirty = null;
            $$.after_update.forEach(add_render_callback);
        }
    }

    let promise;
    function wait() {
        if (!promise) {
            promise = Promise.resolve();
            promise.then(() => {
                promise = null;
            });
        }
        return promise;
    }
    function dispatch(node, direction, kind) {
        node.dispatchEvent(custom_event(`${direction ? 'intro' : 'outro'}${kind}`));
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    const null_transition = { duration: 0 };
    function create_bidirectional_transition(node, fn, params, intro) {
        let config = fn(node, params);
        let t = intro ? 0 : 1;
        let running_program = null;
        let pending_program = null;
        let animation_name = null;
        function clear_animation() {
            if (animation_name)
                delete_rule(node, animation_name);
        }
        function init(program, duration) {
            const d = program.b - t;
            duration *= Math.abs(d);
            return {
                a: t,
                b: program.b,
                d,
                duration,
                start: program.start,
                end: program.start + duration,
                group: program.group
            };
        }
        function go(b) {
            const { delay = 0, duration = 300, easing = identity, tick = noop, css } = config || null_transition;
            const program = {
                start: now() + delay,
                b
            };
            if (!b) {
                // @ts-ignore todo: improve typings
                program.group = outros;
                outros.r += 1;
            }
            if (running_program) {
                pending_program = program;
            }
            else {
                // if this is an intro, and there's a delay, we need to do
                // an initial tick and/or apply CSS animation immediately
                if (css) {
                    clear_animation();
                    animation_name = create_rule(node, t, b, duration, delay, easing, css);
                }
                if (b)
                    tick(0, 1);
                running_program = init(program, duration);
                add_render_callback(() => dispatch(node, b, 'start'));
                loop(now => {
                    if (pending_program && now > pending_program.start) {
                        running_program = init(pending_program, duration);
                        pending_program = null;
                        dispatch(node, running_program.b, 'start');
                        if (css) {
                            clear_animation();
                            animation_name = create_rule(node, t, running_program.b, running_program.duration, 0, easing, config.css);
                        }
                    }
                    if (running_program) {
                        if (now >= running_program.end) {
                            tick(t = running_program.b, 1 - t);
                            dispatch(node, running_program.b, 'end');
                            if (!pending_program) {
                                // we're done
                                if (running_program.b) {
                                    // intro — we can tidy up immediately
                                    clear_animation();
                                }
                                else {
                                    // outro — needs to be coordinated
                                    if (!--running_program.group.r)
                                        run_all(running_program.group.c);
                                }
                            }
                            running_program = null;
                        }
                        else if (now >= running_program.start) {
                            const p = now - running_program.start;
                            t = running_program.a + running_program.d * easing(p / running_program.duration);
                            tick(t, 1 - t);
                        }
                    }
                    return !!(running_program || pending_program);
                });
            }
        }
        return {
            run(b) {
                if (is_function(config)) {
                    wait().then(() => {
                        // @ts-ignore
                        config = config();
                        go(b);
                    });
                }
                else {
                    go(b);
                }
            },
            end() {
                clear_animation();
                running_program = pending_program = null;
            }
        };
    }

    function get_spread_update(levels, updates) {
        const update = {};
        const to_null_out = {};
        const accounted_for = { $$scope: 1 };
        let i = levels.length;
        while (i--) {
            const o = levels[i];
            const n = updates[i];
            if (n) {
                for (const key in o) {
                    if (!(key in n))
                        to_null_out[key] = 1;
                }
                for (const key in n) {
                    if (!accounted_for[key]) {
                        update[key] = n[key];
                        accounted_for[key] = 1;
                    }
                }
                levels[i] = n;
            }
            else {
                for (const key in o) {
                    accounted_for[key] = 1;
                }
            }
        }
        for (const key in to_null_out) {
            if (!(key in update))
                update[key] = undefined;
        }
        return update;
    }
    function get_spread_object(spread_props) {
        return typeof spread_props === 'object' && spread_props !== null ? spread_props : {};
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        if (component.$$.fragment) {
            run_all(component.$$.on_destroy);
            component.$$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            component.$$.on_destroy = component.$$.fragment = null;
            component.$$.ctx = {};
        }
    }
    function make_dirty(component, key) {
        if (!component.$$.dirty) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty = blank_object();
        }
        component.$$.dirty[key] = true;
    }
    function init(component, options, instance, create_fragment, not_equal, prop_names) {
        const parent_component = current_component;
        set_current_component(component);
        const props = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props: prop_names,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty: null
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, props, (key, ret, value = ret) => {
                if ($$.ctx && not_equal($$.ctx[key], $$.ctx[key] = value)) {
                    if ($$.bound[key])
                        $$.bound[key](value);
                    if (ready)
                        make_dirty(component, key);
                }
                return ret;
            })
            : props;
        $$.update();
        ready = true;
        run_all($$.before_update);
        $$.fragment = create_fragment($$.ctx);
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, detail));
    }
    function append_dev(target, node) {
        dispatch_dev("SvelteDOMInsert", { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev("SvelteDOMInsert", { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev("SvelteDOMRemove", { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ["capture"] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev("SvelteDOMAddEventListener", { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev("SvelteDOMRemoveEventListener", { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev("SvelteDOMRemoveAttribute", { node, attribute });
        else
            dispatch_dev("SvelteDOMSetAttribute", { node, attribute, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.data === data)
            return;
        dispatch_dev("SvelteDOMSetData", { node: text, data });
        text.data = data;
    }
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error(`'target' is a required option`);
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn(`Component was already destroyed`); // eslint-disable-line no-console
            };
        }
    }

    function cubicOut(t) {
        const f = t - 1.0;
        return f * f * f + 1.0;
    }

    function fly(node, { delay = 0, duration = 400, easing = cubicOut, x = 0, y = 0, opacity = 0 }) {
        const style = getComputedStyle(node);
        const target_opacity = +style.opacity;
        const transform = style.transform === 'none' ? '' : style.transform;
        const od = target_opacity * (1 - opacity);
        return {
            delay,
            duration,
            easing,
            css: (t, u) => `
			transform: ${transform} translate(${(1 - t) * x}px, ${(1 - t) * y}px);
			opacity: ${target_opacity - (od * u)}`
        };
    }

    /* src/TodoItem.svelte generated by Svelte v3.12.1 */

    const file = "src/TodoItem.svelte";

    function create_fragment(ctx) {
    	var div3, div1, input, t0, div0, t1, div1_transition, t2, div2, current, dispose;

    	const block = {
    		c: function create() {
    			div3 = element("div");
    			div1 = element("div");
    			input = element("input");
    			t0 = space();
    			div0 = element("div");
    			t1 = text(ctx.title);
    			t2 = space();
    			div2 = element("div");
    			div2.textContent = "x";
    			attr_dev(input, "type", "checkbox");
    			add_location(input, file, 67, 8, 1147);
    			attr_dev(div0, "class", "todo-item-label svelte-o6f3cb");
    			toggle_class(div0, "completed", ctx.completed);
    			add_location(div0, file, 68, 8, 1231);
    			attr_dev(div1, "class", "todo-item-left svelte-o6f3cb");
    			add_location(div1, file, 66, 4, 1066);
    			attr_dev(div2, "class", "remove-item svelte-o6f3cb");
    			add_location(div2, file, 71, 4, 1322);
    			attr_dev(div3, "class", "todo-item svelte-o6f3cb");
    			add_location(div3, file, 64, 0, 1037);

    			dispose = [
    				listen_dev(input, "change", ctx.input_change_handler),
    				listen_dev(input, "change", ctx.toggleComplete),
    				listen_dev(div2, "click", ctx.deleteTodo)
    			];
    		},

    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},

    		m: function mount(target, anchor) {
    			insert_dev(target, div3, anchor);
    			append_dev(div3, div1);
    			append_dev(div1, input);

    			input.checked = ctx.completed;

    			append_dev(div1, t0);
    			append_dev(div1, div0);
    			append_dev(div0, t1);
    			append_dev(div3, t2);
    			append_dev(div3, div2);
    			current = true;
    		},

    		p: function update(changed, ctx) {
    			if (changed.completed) input.checked = ctx.completed;

    			if (!current || changed.title) {
    				set_data_dev(t1, ctx.title);
    			}

    			if (changed.completed) {
    				toggle_class(div0, "completed", ctx.completed);
    			}
    		},

    		i: function intro(local) {
    			if (current) return;
    			add_render_callback(() => {
    				if (!div1_transition) div1_transition = create_bidirectional_transition(div1, fly, { y: 20, duration: 300 }, true);
    				div1_transition.run(1);
    			});

    			current = true;
    		},

    		o: function outro(local) {
    			if (!div1_transition) div1_transition = create_bidirectional_transition(div1, fly, { y: 20, duration: 300 }, false);
    			div1_transition.run(0);

    			current = false;
    		},

    		d: function destroy(detaching) {
    			if (detaching) {
    				detach_dev(div3);
    				if (div1_transition) div1_transition.end();
    			}

    			run_all(dispose);
    		}
    	};
    	dispatch_dev("SvelteRegisterBlock", { block, id: create_fragment.name, type: "component", source: "", ctx });
    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	

        let { id, title, completed } = $$props;

        const dispatch = createEventDispatcher();

        function deleteTodo() {
            dispatch('deleteTodo', {
                id: id
            });
        }

        function toggleComplete() {
            dispatch('toggleComplete', {
                id: id
            });
        }

    	const writable_props = ['id', 'title', 'completed'];
    	Object.keys($$props).forEach(key => {
    		if (!writable_props.includes(key) && !key.startsWith('$$')) console.warn(`<TodoItem> was created with unknown prop '${key}'`);
    	});

    	function input_change_handler() {
    		completed = this.checked;
    		$$invalidate('completed', completed);
    	}

    	$$self.$set = $$props => {
    		if ('id' in $$props) $$invalidate('id', id = $$props.id);
    		if ('title' in $$props) $$invalidate('title', title = $$props.title);
    		if ('completed' in $$props) $$invalidate('completed', completed = $$props.completed);
    	};

    	$$self.$capture_state = () => {
    		return { id, title, completed };
    	};

    	$$self.$inject_state = $$props => {
    		if ('id' in $$props) $$invalidate('id', id = $$props.id);
    		if ('title' in $$props) $$invalidate('title', title = $$props.title);
    		if ('completed' in $$props) $$invalidate('completed', completed = $$props.completed);
    	};

    	return {
    		id,
    		title,
    		completed,
    		deleteTodo,
    		toggleComplete,
    		input_change_handler
    	};
    }

    class TodoItem extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, ["id", "title", "completed"]);
    		dispatch_dev("SvelteRegisterComponent", { component: this, tagName: "TodoItem", options, id: create_fragment.name });

    		const { ctx } = this.$$;
    		const props = options.props || {};
    		if (ctx.id === undefined && !('id' in props)) {
    			console.warn("<TodoItem> was created without expected prop 'id'");
    		}
    		if (ctx.title === undefined && !('title' in props)) {
    			console.warn("<TodoItem> was created without expected prop 'title'");
    		}
    		if (ctx.completed === undefined && !('completed' in props)) {
    			console.warn("<TodoItem> was created without expected prop 'completed'");
    		}
    	}

    	get id() {
    		throw new Error("<TodoItem>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set id(value) {
    		throw new Error("<TodoItem>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get title() {
    		throw new Error("<TodoItem>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set title(value) {
    		throw new Error("<TodoItem>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get completed() {
    		throw new Error("<TodoItem>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set completed(value) {
    		throw new Error("<TodoItem>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/Todos.svelte generated by Svelte v3.12.1 */

    const file$1 = "src/Todos.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = Object.create(ctx);
    	child_ctx.todo = list[i];
    	return child_ctx;
    }

    // (148:4) {#each filteredTodos as todo}
    function create_each_block(ctx) {
    	var div, current;

    	var todoitem_spread_levels = [
    		ctx.todo
    	];

    	let todoitem_props = {};
    	for (var i = 0; i < todoitem_spread_levels.length; i += 1) {
    		todoitem_props = assign(todoitem_props, todoitem_spread_levels[i]);
    	}
    	var todoitem = new TodoItem({ props: todoitem_props, $$inline: true });
    	todoitem.$on("deleteTodo", ctx.handleDeleteTodo);
    	todoitem.$on("toggleComplete", ctx.handleToggleComplete);

    	const block = {
    		c: function create() {
    			div = element("div");
    			todoitem.$$.fragment.c();
    			attr_dev(div, "class", "todo-item");
    			add_location(div, file$1, 148, 8, 3304);
    		},

    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			mount_component(todoitem, div, null);
    			current = true;
    		},

    		p: function update(changed, ctx) {
    			var todoitem_changes = (changed.filteredTodos) ? get_spread_update(todoitem_spread_levels, [
    									get_spread_object(ctx.todo)
    								]) : {};
    			todoitem.$set(todoitem_changes);
    		},

    		i: function intro(local) {
    			if (current) return;
    			transition_in(todoitem.$$.fragment, local);

    			current = true;
    		},

    		o: function outro(local) {
    			transition_out(todoitem.$$.fragment, local);
    			current = false;
    		},

    		d: function destroy(detaching) {
    			if (detaching) {
    				detach_dev(div);
    			}

    			destroy_component(todoitem);
    		}
    	};
    	dispatch_dev("SvelteRegisterBlock", { block, id: create_each_block.name, type: "each", source: "(148:4) {#each filteredTodos as todo}", ctx });
    	return block;
    }

    function create_fragment$1(ctx) {
    	var div5, h1, i, t1, t2, input0, t3, t4, div2, div0, label, input1, t5, t6, div1, t7, t8, t9, div4, div3, button0, t11, button1, t13, button2, t15, dir, button3, current, dispose;

    	let each_value = ctx.filteredTodos;

    	let each_blocks = [];

    	for (let i_1 = 0; i_1 < each_value.length; i_1 += 1) {
    		each_blocks[i_1] = create_each_block(get_each_context(ctx, each_value, i_1));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	const block = {
    		c: function create() {
    			div5 = element("div");
    			h1 = element("h1");
    			i = element("i");
    			i.textContent = "ballot";
    			t1 = text(" Todo App");
    			t2 = space();
    			input0 = element("input");
    			t3 = space();

    			for (let i_1 = 0; i_1 < each_blocks.length; i_1 += 1) {
    				each_blocks[i_1].c();
    			}

    			t4 = space();
    			div2 = element("div");
    			div0 = element("div");
    			label = element("label");
    			input1 = element("input");
    			t5 = text("Check All");
    			t6 = space();
    			div1 = element("div");
    			t7 = text(ctx.todosRemaining);
    			t8 = text(" items left");
    			t9 = space();
    			div4 = element("div");
    			div3 = element("div");
    			button0 = element("button");
    			button0.textContent = "All";
    			t11 = space();
    			button1 = element("button");
    			button1.textContent = "Active";
    			t13 = space();
    			button2 = element("button");
    			button2.textContent = "Completed";
    			t15 = space();
    			dir = element("dir");
    			button3 = element("button");
    			button3.textContent = "Clear Completed";
    			attr_dev(i, "class", "material-icons svelte-1vjbqkd");
    			add_location(i, file$1, 143, 8, 3083);
    			attr_dev(h1, "class", "svelte-1vjbqkd");
    			add_location(h1, file$1, 143, 4, 3079);
    			attr_dev(input0, "type", "text");
    			attr_dev(input0, "class", "todo-input svelte-1vjbqkd");
    			attr_dev(input0, "placeholder", "Insert todo item ...");
    			add_location(input0, file$1, 145, 4, 3139);
    			attr_dev(input1, "class", "inner-container-input svelte-1vjbqkd");
    			attr_dev(input1, "type", "checkbox");
    			add_location(input1, file$1, 154, 20, 3519);
    			add_location(label, file$1, 154, 13, 3512);
    			add_location(div0, file$1, 154, 8, 3507);
    			add_location(div1, file$1, 155, 8, 3630);
    			attr_dev(div2, "class", "inner-container svelte-1vjbqkd");
    			add_location(div2, file$1, 153, 4, 3469);
    			attr_dev(button0, "class", "svelte-1vjbqkd");
    			toggle_class(button0, "active", ctx.currentFilter === 'all');
    			add_location(button0, file$1, 160, 12, 3741);
    			attr_dev(button1, "class", "svelte-1vjbqkd");
    			toggle_class(button1, "active", ctx.currentFilter === 'active');
    			add_location(button1, file$1, 161, 12, 3852);
    			attr_dev(button2, "class", "svelte-1vjbqkd");
    			toggle_class(button2, "active", ctx.currentFilter === 'completed');
    			add_location(button2, file$1, 162, 12, 3972);
    			add_location(div3, file$1, 159, 8, 3723);
    			attr_dev(button3, "class", "svelte-1vjbqkd");
    			add_location(button3, file$1, 166, 12, 4131);
    			add_location(dir, file$1, 165, 8, 4113);
    			attr_dev(div4, "class", "inner-container svelte-1vjbqkd");
    			add_location(div4, file$1, 158, 4, 3685);
    			attr_dev(div5, "class", "container svelte-1vjbqkd");
    			add_location(div5, file$1, 141, 0, 3050);

    			dispose = [
    				listen_dev(input0, "input", ctx.input0_input_handler),
    				listen_dev(input0, "keydown", ctx.addTodo),
    				listen_dev(input1, "change", ctx.checkAllTodos),
    				listen_dev(button0, "click", ctx.click_handler),
    				listen_dev(button1, "click", ctx.click_handler_1),
    				listen_dev(button2, "click", ctx.click_handler_2),
    				listen_dev(button3, "click", ctx.clearCompleted)
    			];
    		},

    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},

    		m: function mount(target, anchor) {
    			insert_dev(target, div5, anchor);
    			append_dev(div5, h1);
    			append_dev(h1, i);
    			append_dev(h1, t1);
    			append_dev(div5, t2);
    			append_dev(div5, input0);

    			set_input_value(input0, ctx.newTodoTitle);

    			append_dev(div5, t3);

    			for (let i_1 = 0; i_1 < each_blocks.length; i_1 += 1) {
    				each_blocks[i_1].m(div5, null);
    			}

    			append_dev(div5, t4);
    			append_dev(div5, div2);
    			append_dev(div2, div0);
    			append_dev(div0, label);
    			append_dev(label, input1);
    			append_dev(label, t5);
    			append_dev(div2, t6);
    			append_dev(div2, div1);
    			append_dev(div1, t7);
    			append_dev(div1, t8);
    			append_dev(div5, t9);
    			append_dev(div5, div4);
    			append_dev(div4, div3);
    			append_dev(div3, button0);
    			append_dev(div3, t11);
    			append_dev(div3, button1);
    			append_dev(div3, t13);
    			append_dev(div3, button2);
    			append_dev(div4, t15);
    			append_dev(div4, dir);
    			append_dev(dir, button3);
    			current = true;
    		},

    		p: function update(changed, ctx) {
    			if (changed.newTodoTitle && (input0.value !== ctx.newTodoTitle)) set_input_value(input0, ctx.newTodoTitle);

    			if (changed.filteredTodos) {
    				each_value = ctx.filteredTodos;

    				let i_1;
    				for (i_1 = 0; i_1 < each_value.length; i_1 += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i_1);

    					if (each_blocks[i_1]) {
    						each_blocks[i_1].p(changed, child_ctx);
    						transition_in(each_blocks[i_1], 1);
    					} else {
    						each_blocks[i_1] = create_each_block(child_ctx);
    						each_blocks[i_1].c();
    						transition_in(each_blocks[i_1], 1);
    						each_blocks[i_1].m(div5, t4);
    					}
    				}

    				group_outros();
    				for (i_1 = each_value.length; i_1 < each_blocks.length; i_1 += 1) {
    					out(i_1);
    				}
    				check_outros();
    			}

    			if (!current || changed.todosRemaining) {
    				set_data_dev(t7, ctx.todosRemaining);
    			}

    			if (changed.currentFilter) {
    				toggle_class(button0, "active", ctx.currentFilter === 'all');
    				toggle_class(button1, "active", ctx.currentFilter === 'active');
    				toggle_class(button2, "active", ctx.currentFilter === 'completed');
    			}
    		},

    		i: function intro(local) {
    			if (current) return;
    			for (let i_1 = 0; i_1 < each_value.length; i_1 += 1) {
    				transition_in(each_blocks[i_1]);
    			}

    			current = true;
    		},

    		o: function outro(local) {
    			each_blocks = each_blocks.filter(Boolean);
    			for (let i_1 = 0; i_1 < each_blocks.length; i_1 += 1) {
    				transition_out(each_blocks[i_1]);
    			}

    			current = false;
    		},

    		d: function destroy(detaching) {
    			if (detaching) {
    				detach_dev(div5);
    			}

    			destroy_each(each_blocks, detaching);

    			run_all(dispose);
    		}
    	};
    	dispatch_dev("SvelteRegisterBlock", { block, id: create_fragment$1.name, type: "component", source: "", ctx });
    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let newTodoTitle = '';

        let currentFilter = 'all';

        let nextId = 4;

        let todos = [
            {
                id: 1,
                title: 'My first todo with svelte',
                completed: false
            },
            {
                id: 2,
                title: 'Study JS',
                completed: false
            },
            {
                id: 3,
                title: 'Study React',
                completed: false
            }
        ];

        function addTodo(event) {
            if (event.key === 'Enter') {
                $$invalidate('todos', todos = [...todos, {
                    id: nextId,
                    completed: false,
                    title: newTodoTitle
                }]);
                nextId = nextId + 1;
                $$invalidate('newTodoTitle', newTodoTitle = '');
            }
        }

        function checkAllTodos(event) {
            todos.forEach(todo => todo.completed = event.target.checked);
            $$invalidate('todos', todos);
        }

        function updateFilter(newFilter) {
            $$invalidate('currentFilter', currentFilter = newFilter);
        }

        function clearCompleted() {
            $$invalidate('todos', todos = todos.filter(todo => !todo.completed));
        }

        function handleDeleteTodo(event) {
            $$invalidate('todos', todos = todos.filter(todo => todo.id !== event.detail.id));
        }

        function handleToggleComplete(event) {
            const todoIndex = todos.findIndex(todo => todo.id === event.detail.id);
            
            const updatedTodo = { ...todos[todoIndex], completed: !todos[todoIndex].completed};
            
            $$invalidate('todos', todos = [
                ...todos.slice(0, todoIndex),
                updatedTodo,
                ...todos.slice(todoIndex+1)
            ]);
        }

    	function input0_input_handler() {
    		newTodoTitle = this.value;
    		$$invalidate('newTodoTitle', newTodoTitle);
    	}

    	const click_handler = () => updateFilter('all');

    	const click_handler_1 = () => updateFilter('active');

    	const click_handler_2 = () => updateFilter('completed');

    	$$self.$capture_state = () => {
    		return {};
    	};

    	$$self.$inject_state = $$props => {
    		if ('newTodoTitle' in $$props) $$invalidate('newTodoTitle', newTodoTitle = $$props.newTodoTitle);
    		if ('currentFilter' in $$props) $$invalidate('currentFilter', currentFilter = $$props.currentFilter);
    		if ('nextId' in $$props) nextId = $$props.nextId;
    		if ('todos' in $$props) $$invalidate('todos', todos = $$props.todos);
    		if ('todosRemaining' in $$props) $$invalidate('todosRemaining', todosRemaining = $$props.todosRemaining);
    		if ('filteredTodos' in $$props) $$invalidate('filteredTodos', filteredTodos = $$props.filteredTodos);
    	};

    	let todosRemaining, filteredTodos;

    	$$self.$$.update = ($$dirty = { currentFilter: 1, todos: 1, filteredTodos: 1 }) => {
    		if ($$dirty.currentFilter || $$dirty.todos) { $$invalidate('filteredTodos', filteredTodos = currentFilter === 'all' ? todos : currentFilter === 'completed'
                    ? todos.filter(todo => todo.completed)
                    : todos.filter(todo => !todo.completed)); }
    		if ($$dirty.filteredTodos) { $$invalidate('todosRemaining', todosRemaining = filteredTodos.filter(todo => !todo.completed).length); }
    	};

    	return {
    		newTodoTitle,
    		currentFilter,
    		addTodo,
    		checkAllTodos,
    		updateFilter,
    		clearCompleted,
    		handleDeleteTodo,
    		handleToggleComplete,
    		todosRemaining,
    		filteredTodos,
    		input0_input_handler,
    		click_handler,
    		click_handler_1,
    		click_handler_2
    	};
    }

    class Todos extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, []);
    		dispatch_dev("SvelteRegisterComponent", { component: this, tagName: "Todos", options, id: create_fragment$1.name });
    	}
    }

    /* src/App.svelte generated by Svelte v3.12.1 */

    function create_fragment$2(ctx) {
    	var current;

    	var todos = new Todos({ $$inline: true });

    	const block = {
    		c: function create() {
    			todos.$$.fragment.c();
    		},

    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},

    		m: function mount(target, anchor) {
    			mount_component(todos, target, anchor);
    			current = true;
    		},

    		p: noop,

    		i: function intro(local) {
    			if (current) return;
    			transition_in(todos.$$.fragment, local);

    			current = true;
    		},

    		o: function outro(local) {
    			transition_out(todos.$$.fragment, local);
    			current = false;
    		},

    		d: function destroy(detaching) {
    			destroy_component(todos, detaching);
    		}
    	};
    	dispatch_dev("SvelteRegisterBlock", { block, id: create_fragment$2.name, type: "component", source: "", ctx });
    	return block;
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, null, create_fragment$2, safe_not_equal, []);
    		dispatch_dev("SvelteRegisterComponent", { component: this, tagName: "App", options, id: create_fragment$2.name });
    	}
    }

    const app = new App({
    	target: document.body,
    	props: {
    		name: 'world'
    	}
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
