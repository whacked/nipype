
// TODO Add a title bar for iframe (which node and which output of that node, along with close button)
// TODO clicking on node closes the menu (harder)
// TODO mousing through menu shouldn't dim the corresponding node
// TODO why don't the nodes line up down the center?
server = document.URL.split('/', 3).join('/');

// d3.json('pipeline.json', function(error, graph) {
$.post('/getGraphJSON', function(graph) {


    // TODO remove this global var
    _graph = graph;

    var IN_PROGRESS_COLOR = '#1f77b4';
    var FAILURE_COLOR = '#d62728';
    var COMPLETED_COLOR = '#2ca02c';
    // constants
    var DIM_OPACITY = .2;
    var NEIGHBOR_OPACITY = .7;
    var SELECTED_OPACITY = .9;
    var DEFAULT_OPACITY = SELECTED_OPACITY;
    var SELECTED_LINK_OPACITY = .99;
    var DEFAULT_LINK_OPACITY = .4;
    var MOUSEOVER_TRANSITION_TIME = 100;
    var EXPAND_TRANSITION_TIME = 300;
    var SMALL_ICON_SIZE = 21;
    var IFRAME_HEIGHT = 400;
    var IFRAME_WIDTH = 600;
    var TEXT_OFFSET = 23;
    var LEGEND_ITEM_HEIGHT; // set below after sizer()
    var LEGEND_PAD = 6;

    var NODESIZE = 12;
    var BORDER = .03;

    // var w = 900*.75,
    //     h = 1260*.75;
    var w = 1200,
        h = 1720;

    // Declarations
    var color, nstages, xscale, xgap;
    var istage, supernodesInStage, truex, border, yscale;
    var i, l;
    var svg, subnode_g, subnode_circle, subnode_text, subnode_text_shadow,
        subnode_text_fg, supernode_g, supernode_circle, supernode_plussign,
        singleton, multiparent;
    var legend;

    ///////////////////////
    // Utility functions //
    ///////////////////////
    function assert(condition, message) {
        if (!condition) {
            throw message || "Assertion failed";
        }
    };
    function hide(d) {
        d._hidden = true;
    };
    function unhide(d) {
        d._hidden = false;
    };
    function abbreviateText(str, threshold) {
        threshold = threshold || 200;
        if (str.length > threshold) {
            return str.substring(0, threshold) + "...";
        } else {
            return str;
        }
    }
    function sizer(k) {
        return Math.sqrt(Math.sqrt(k+1)) * NODESIZE;
    }
    LEGEND_ITEM_HEIGHT = 2 * sizer(1.5);
    function mySlicer(arr, indices) {
        out = [];
        for (var i=0; i<indices.length; i++) {
            out.push(arr[indices[i]]);
        }
        return out;
    }
    $.ajaxSetup({
        timeout: 1000 * 60 // global AJAX timeout of 1 minute
    });

    function pollNodeStatuses() {
        $.get('/nodeStatuses', function(result) {
            // assumes server will sleep before responding for a "long poll"
            subnode_circle
                .style("stroke", function(d, i) {
                    d.completionStatus = result[i];
                    if (result[i] === 0) {
                        return IN_PROGRESS_COLOR;
                    } else if (result[i] === 1) {
                        return COMPLETED_COLOR;
                    } else if (result[i] === -1) {
                        return FAILURE_COLOR;
                    }
                });
            supernode_g
                .each(function(d_super) {
                    var foundProgress = false;
                    var foundCompleted = false;
                    var foundFailure = false;
                    d3.selectAll(d_super.subnode_elements)
                        .each(function(d_sub) {
                            if (d_sub.completion_status === 0) {
                                foundProgress = true;
                            } else if (d_sub.completion_status === 1) {
                                foundCompleted = true;
                            } else if (d_sub.completion_status === -1) {
                                foundFailure = true;
                            }
                        });
                    d_super.strokeStyle = gradientMap[[foundProgress, foundCompleted, foundFailure]];
                })
                .style("stroke", function(d_super) { return d_super.strokeStyle; });
            pollNodeStatuses(); // keep polling forever
        });

    }
    var gradientMap = {};
    //    [progress, completed, failure]
    gradientMap[[true, true, true]] = '#(gradientProgressCompletedFailure)';
    gradientMap[[true, true, false]] = '#(gradientProgressCompleted)';
    gradientMap[[true, false, true]] = '#(gradientProgressFailure)';
    gradientMap[[false, true, true]] = '#(gradientCompletedFailure)';
    gradientMap[[false, false, true]] = IN_PROGRESS_COLOR;
    gradientMap[[false, true, false]] = COMPLETED_COLOR;
    gradientMap[[true, false, false]] = FAILURE_COLOR;

    /**
     * Compare two nodes to see the relationship between them.
     * The two nodes can be subnodes or supernodes (don't have to
     * be the same type)
     */
    function compare(d1, d2, same, neighbor, other) {
        assert(!d1.hidden);
        assert(!d2.hidden);
        var out;
        var i = (d1.type === 'super') ? d1.id : ("supernode" + d1.supernode);
        var j = (d2.type === 'super') ? d2.id : ("supernode" + d2.supernode);
        if (d1.id === d2.id) {
            out= same;
        } else if(superadjacency[i + "," + j] || superadjacency[j + "," + i]) {
            out = neighbor;
        } else if (( (d1.type === 'super') && (d2.type === 'sub') && (d1.subnodes.indexOf(d2.index) > -1)) ||
                    ( (d2.type === 'super') && (d1.type === 'sub') && (d2.subnodes.indexOf(d1.index) > -1))) {
            out = neighbor;
        } else {
            out = other;
        }
        return out;
    };

    ///////////
    // Setup //
    ///////////
    graph.subnodes.forEach(function(d, i) {
        d.children = [];
        if (d.parameterization === null) {
            d.descr = graph.supernodes[graph.reverse_mapping[i]].name;
        } else {
            d.descr = d.parameterization.join(", ");
        }
        d.type = 'sub';
    });
    color = d3.scale.category10();

    nstages = d3.max(graph.supernodes, function(d) { return d.stage; });
    xscale = d3.scale.linear()
        .domain([-1, nstages+1])
        .range([BORDER*w, (1-BORDER)*w]);

    xgap = (xscale(2) - xscale(1));

    for (var istage=0; istage<=nstages; istage++) {
        var supernodesInStage = graph.supernodes.filter(function(d) { return d.stage === istage; });
        var truex = xscale(istage);

        // TODO make a fixed grid with offsets per stage
        // i.e. stage 1 is 1, 4, 7, 10, 13
        //      stage 2 is 2, 5, 8, 11, 14
        //      stage 3 is 3, 6, 9, ...
        //var border = BORDER + 6*BORDER*(istage % 2);
        var yscale = d3.scale.linear()
            .domain([0, supernodesInStage.length-1])
            //.range([0, (1-border)*h]);
            .range([BORDER*6*h, (1-BORDER*6)*h]);

        var stageSize = supernodesInStage.length;
        for (var jjj=0; jjj<stageSize; jjj++) {
            var stageOffset;
            if (stageSize === 1) {
                stageOffset = 0;
            } else {
                stageOffset = (((jjj/(stageSize-1))-.5) * (xgap*.75));
            }
            s = supernodesInStage[jjj];
        //supernodesInStage.forEach(function(s) {
            s.type = 'super';
            s.descr = s.name;
            s.truey = yscale(s.height);
            s.truex = truex + stageOffset;
            //s.truex = truex;
        };
        //});
    }

    // adjacency = {};
    superadjacency = {};
    for (i=0; i<graph.links.length; i++) {
        l = graph.links[i];
        l.source = graph.supernodes[l.supersource];
        l.target = graph.supernodes[l.supertarget];
        if (l.weight > 0) {
            // adjacency["subnode" + l.source + ",subnode" + l.target] = 1;
            superadjacency["supernode" + l.supersource + ",supernode" + l.supertarget] = 1;
        }
    }

    svg = d3.select(".canvas").append("svg")
            .attr("height", w*1.2)
            .attr("width", h);
    MARKER_SIZE = 5;

    defs = svg.append('defs');
    arrowhead = defs.append('marker')
        .attr('id', 'arrowhead')
        .attr('markerWidth', MARKER_SIZE)
        .attr('markerHeight', MARKER_SIZE)
        .attr('viewBox', '-6 -6 12 12')
        .attr('markerUnits', 'strokeWidth')
        .attr('refX', '5')
        .attr('refY', '0')
        .attr('orient', 'auto')
        .style('fill-opacity', 'inherit')
        .style('opacity', 'inherit')
        .style('stroke-opacity', 'inherit');

    /// make color gradients
    var bProgress, bCompleted, bFailure;
    var gradientName, gradientStopCtr, gradientCount;
    var boolList, nameList, colorList;
    var curBool, curName, curColor;
    nameList = ['Progress', 'Completed', 'Failure'];
    colorList = [IN_PROGRESS_COLOR, COMPLETED_COLOR, FAILURE_COLOR];
    var TRUTH_VALUES = [true, false];
    for (bP in TRUTH_VALUES) {
        for (bC in TRUTH_VALUES) {
            for (bF in TRUTH_VALUES) {
                bProgress = bP === "1";
                bCompleted = bC === "1";
                bFailure = bF === "1";
                gradientCount = bProgress + bCompleted + bFailure;
                if (gradientCount <= 1) {
                    continue;
                }
                gradient = defs.append('linearGradient')
                gradientName = 'gradient';
                gradientStopCtr = 0;
                boolList = [bProgress, bCompleted, bFailure];
                for (i=0 ; i<3 ; i++) {
                    curBool = boolList[i];
                    curName = nameList[i];
                    curColor = colorList[i];
                    if (curBool) {
                        gradientName += curName;
                        gradient.append('stop')
                            .attr('offset', gradientStopCtr * (100/(gradientCount+1)) + '%')
                            .attr('stop-color', curColor);
                        gradientCount += 1;
                    }
                }
                gradient.attr('id', gradientName);
            }
        }
    }

    legend = svg.append("g")
        .attr("class", "legend")
        .attr("transform", "translate(" + h*.65 + "," + w*.8 + ")")
        .attr("preserveAspectRatio", "xMaxYMin meet");

    legend_items = legend.selectAll(".legenditem")
            .data(graph.klasses)
          .enter().append("g")
            .attr("class", "legenditem")
            .attr("transform", function(d, i) {
                return "translate(0," + (i+1) * LEGEND_ITEM_HEIGHT + ")";
            });

    legend_circles = legend_items.append("circle")
        .attr("r", sizer(.5))
        .style("fill", function(d, i) { return color(i); });
    legend_labels = legend_items.append("text")
        .text(function(d) { return d; })
        .style("font-size", "0.85em")
        .attr("transform", "translate(" + TEXT_OFFSET + ", 0)");

    legend_label = legend.append("text")
        .text("Legend")
        .attr("text-anchor", "middle")
        .attr("transform", "translate(0,0)");

    bbox = legend[0][0].getBBox();
    legend_label.attr("transform", "translate(" + (bbox.x + bbox.width/2) + ",0)");

    legend_outline = legend.append("rect")
        .attr("x", bbox.x - LEGEND_PAD)
        .attr("y", bbox.y - LEGEND_PAD)
        .attr("width", bbox.width + 2*LEGEND_PAD)
        .attr("height", bbox.height + 2*LEGEND_PAD)
        .attr("rx", "5px")
        .attr("ry", "5px")
        .style("-webkit-svg-shadow", "0 0 7px")
        .style("stroke", "#7f7f7f")
        .style("stroke-width", "2px")
        .style("fill", "none");

    marker = arrowhead.append('polygon')
        .attr('points', '-2,0 -5,5 5,0 -5,-5');

    link = svg.selectAll(".link")
          .data(graph.links)
        .enter().append("line")
          .attr("class", "link")
          .attr('marker-end', 'url(#arrowhead)')
          .style("stroke-width", 3)
          .style("stroke-opacity", DEFAULT_LINK_OPACITY)
          .style("opacity", DEFAULT_LINK_OPACITY);

    ///////////////////////////////////////////////////////////////////////////
    // Initialize nodes

    // Initialize subnodes: each is a <g> w/ both circle and text
    subnode_g = svg.selectAll(".subnode")
          .data(graph.subnodes)
        .enter().append("g")
          .attr("class", "node subnode")
          .attr("visibility", "visible")
          .style("opacity", 0);

    subnode_circle = subnode_g.append("svg:circle")
          .attr("r", function(d) { d.radius = NODESIZE; return d.radius; })
          .attr("id", function(d) { return d.id; })
          .style("fill", function(d) { return color(d.klass); });

    // Initialize text: container <g>, "shadow"/embossing, and foreground
    subnode_text = subnode_g
        .append("svg:g")
        .attr("class", "text-container")
        .attr("transform", "translate(" + TEXT_OFFSET + ",0)");

    subnode_text_shadow = subnode_text.append("svg:text")
        .attr("class", function(d) { return d.id + "text" + " shadow labeltext"; })
        .text(function(d) { return d.descr; });

    subnode_text_fg = subnode_text.append("svg:text")
        .attr("class", function(d) { return d.id + "text" + " foreground labeltext"; })
        .text(function(d) { return d.descr; });

    // Initialize supernodes: each is a <g> w/both circle and [+]/[-] text
    // supernodes should go second so that they're on top (and clickable)
    supernode_g = svg.selectAll(".supernode")
        .data(graph.supernodes)
      .enter().append("g")
        .attr("class", "node supernode")
        .attr("visibility", "visible")
        .attr("transform", function(d) {
            //return "translate(" + d.truex + "," + d.truey + ")";
            return "translate(" + d.truey + "," + d.truex + ")";
        })
        .style("opacity", DEFAULT_OPACITY);

    supernode_circle = supernode_g.append("circle")
        .attr("r", function(d) { d.radius = sizer(d.subnodes.length); return d.radius; })
        .style("fill", function(d) { return color(d.klass); });

    supernode_plussign = supernode_g.append("text")
        .attr("text-anchor", "middle")
        .text(function(d) { return d.subnodes.length > 0 ? "[+]" : ""; })
        .attr("dy", "0.5ex");

    supernode_text = supernode_g
        .append("svg:g")
        .attr("class", "text-container")
        .attr("transform", "translate(-" + TEXT_OFFSET + ",0)");

    supernode_text_shadow = supernode_text.append("svg:text")
        .attr("class", function(d) { return d.id + "text" + " shadow labeltext"; })
        .attr("text-anchor", "end")
        .text(function(d) { return abbreviateText(d.name); });

    supernode_text_fg = supernode_text.append("svg:text")
        .attr("class", function(d) { return d.id + "text" + " foreground labeltext"; })
        .attr("text-anchor", "end")
        .text(function(d) { return abbreviateText(d.name); });

    // Establish mappings between the supernodes and subnodes
    supernode_g.each(function(d_super, i) {
        d_super.subnode_elements = mySlicer(subnode_g[0], d_super.subnodes);
        // set all subnodes to be located at the same position as their supernode
        });

    subnode_g.each(function(d, i) {
        d.supernode_element = supernode_g[0][graph.reverse_mapping[i]];
        supernode_g.each(function(d_super, i) {
            d3.selectAll(d_super.subnode_elements)
                .style("pointer-events", "none")
                .each(function(d_sub) { hide(d_sub); });
        });
    });
    function moveSubnodesToSupernodes() {

        supernode_g.each(function(d_super, i) {
            d3.selectAll(d_super.subnode_elements)
                .attr("transform", function(d_sub) {
                    //return "translate(" + d_super.truex + "," + d_super.y + ")";
                    return "translate(" + d_super.y + "," + d_super.truex + ")";
                });
        });
    };

    // Set up singleton supernodes to be their child nodes
    singleton = supernode_g.filter(function(d, i) {
        return (d.subnode_elements.length === 1);
    });
    multiparent = supernode_g
        .filter(function(d, i) {
            return (d.subnode_elements.length > 1);
        })
        .each(function(d, i) {
            d._collapsed = true;
        });

    singleton
        .attr("visibility", "hidden")
        .each(function(d_super, i) {
            d3.selectAll(d_super.subnode_elements)
                .style("opacity", 1)
                .style("pointer-events", "all")
                .each(function(d_sub) {
                    unhide(d_sub);
                    d_sub.descr = d_super.descr + " (" + d_sub.descr + ")";
                    console.log(d_sub);
                });
        });

    subnode_text_fg.text(function(d) { return d.descr; });


    ///////////////////////////////////////////////////////////////////////////
    // Initialize links

    d3.selectAll(".node")
        .on("mouseover", function(d_this) {
            d3.select(this).style('cursor', 'pointer');
            var thisi = d_this.supernode || d_this.index;
            if (d_this.hidden) {
                return;
            }
            d3.selectAll(".node")
                .transition().duration(MOUSEOVER_TRANSITION_TIME)
                .style("opacity", function(d_other) {
                    if (d_other._hidden) {
                        return 0;
                    } else {
                        return compare(d_this, d_other,
                            SELECTED_OPACITY, NEIGHBOR_OPACITY, DIM_OPACITY);
                    }
                });
            d3.selectAll(".labeltext")
                .text(function(d_other) { return compare(d_this, d_other, d_other.descr, d_other.descr, abbreviateText(d_other.descr)); });
            d3.selectAll(".link")
                .filter(function(d_link) { return d_link.supersource === thisi || d_link.supertarget === thisi; })
                .transition().duration(MOUSEOVER_TRANSITION_TIME)
                .style("stroke-opacity", SELECTED_LINK_OPACITY)
                .style("opacity", SELECTED_LINK_OPACITY);
        })
        .on("mouseout", function(d_this) {
            d3.select(this).style('cursor', 'default');
            if (d_this.hidden) {
                return;
            }
            d3.selectAll(".node")
                .filter(function(d) { return !d._hidden; })
                .transition().duration(MOUSEOVER_TRANSITION_TIME)
                .style("opacity", SELECTED_OPACITY);
            d3.selectAll(".labeltext")
                .text(function(d_other) { return abbreviateText(d_other.descr); });
            d3.selectAll(".link")
                .transition().duration(MOUSEOVER_TRANSITION_TIME)
                .style("opacity", DEFAULT_LINK_OPACITY);
        });

    multiparent
        .on("click", function(d_super, i_super) {
            // TODO clean this up: no copy-paste
            if (d_super._collapsed) {
                d_super._collapsed = false;
                d3.select(this).select('text')
                    .text('[-]');
                d3.selectAll(d_super.subnode_elements)
                        .each(function(d_sub) { unhide(d_sub); })
                        .style("pointer-events", "all")
                    .transition().duration(EXPAND_TRANSITION_TIME)
                        .style("opacity", 1)
                        .attr("transform", function(d_sub, i_sub) {
                            var offset = (d_super.subnode_elements.length - 1)/2;
                            // var dx = d_super.truex + xgap/2;
                            // var dy = d_super.y + (i_sub - offset) * 30;
                            var dy = d_super.y + xgap/2;// + (i_sub - offset)*30;
                            var dx = d_super.x + (i_sub - offset) * 30;
                            //return "translate(" + dx + "," + dy + ")";
                            return "translate(" + dy + "," + dx + ")";
                        });
            } else {
                d_super._collapsed = true;
                d3.select(this).select('text')
                    .text('[+]');
                d3.selectAll(d_super.subnode_elements)
                        .each(function(d_sub) { hide(d_sub); })
                        .style("pointer-events", "none")
                    .transition().duration(EXPAND_TRANSITION_TIME)
                        .style("opacity", 0)
                        .attr("transform", function(d_sub, i_sub) {
                            var dx = d_super.truex;
                            var dy = d_super.y;
                            return "translate(" + dy + "," + dx + ")";
                        });
            }
        });

    graph.supernodes.forEach(function(d) {
        d.x = d.truex;
        d.y = 0;
    });

    subnode_circle
        .on("click", function(d_node, i_node) {
            // TODO make these all vars
            if (d_node.menu && !(d_node.menu === undefined)) {
                d_node.menu.remove();
                d_node.menu = false;
            } else {
                circle = this;
                color = d3.rgb(d3.select(circle).style('fill'));
                loc = d3.transform(d3.select(circle.parentNode).attr("transform")).translate
                // TODO dim all other nodes
                $.post('/getOutputInfo', {"index": i_node}, function(result) {
                    var _menu = d3.select(".canvas").append('ul')
                            .attr('nodeindex', i_node)
                            .attr('class', 'textmenu')
                            .style("left", (loc[0]+25) + "px")
                            .style("top", (loc[1]+20) + "px");
                    d_node.menu = _menu;
                    var _menuItems = _menu.selectAll('li')
                            .data(result)
                          .enter().append('li')
                            .html(function(d_item) {
                                var type;
                                if (d_item.type === 'string') {
                                    type = 'fa-align-justify';
                                } else if (d_item.type === 'file') {
                                    type = 'fa-file-image-o';
                                }
                                return '<i class="fa ' + type + ' fa-fw"></i>&nbsp; ' + d_item.name;
                            })
                            .style('border-bottom', '1px solid ' + color.toString())
                            .style('padding', '3px')
                            .style('background-color', function(d_item) {
                                return color.brighter(2);
                            })
                            .style('text-align', function(d_item) {
                                if (d_item.type === 'close') {
                                    return 'center';
                                } else {
                                    return 'left';
                                }
                            })
                            .on("mouseover", function(d_item) {
                                d3.select(this)
                                    .style('background-color',color.brighter(1))
                                    .style('cursor', 'pointer');
                            })
                            .on("mouseout", function(d_item) {
                                d3.select(this)
                                    .style('background-color',color.brighter(2))
                                    .style('cursor', 'default');
                            })
                            .on("click", function(d_item) {
                                if (d_item.type === 'string') {
                                    // TODO nice text box here
                                    window.alert(d_item.value);
                                } else if (d_item.type === 'file') {
                                    // create a slicedrop iframe
                                    var filename = d_item.value;
                                    var url = 'http://slicedrop.com/?' + server + '/retrieveFile?filename=' + filename;
                                    var popupdiv = d3.select('.canvas').append('div')
                                        .attr('class', 'popup')
                                        .style('width', IFRAME_WIDTH + 'px')
                                        .style('height', IFRAME_HEIGHT + 'px');
                                    $('.popup').draggable().resizable();


                                    var sdFrame = popupdiv.append('iframe')
                                        .attr('id', 'vizFrame')
                                        .attr('width', '96%')
                                        .style('height', '95%')
                                        .style('margin', 'auto')
                                        .style('margin-top', '3%')
                                        .attr('src', url);
                                        // .style('margin-bottom', -200)
                                        // .style('margin-left', -200)
                                    var sdFrameClose = popupdiv.append('img')
                                        .attr('id', 'sliceDropClose')
                                        .attr('src', 'static/closebutton.png')
                                        .style('margin', 'auto')
                                        .style('position', 'absolute')
                                        .style('left', IFRAME_WIDTH +'px')
                                        .style('top', IFRAME_HEIGHT + 'px')
                                        .on("mouseover", function(d) {
                                            d3.select(this).style('cursor', 'pointer');
                                        })
                                        .on("mouseout", function(d) {
                                            d3.select(this).style('cursor', 'default');
                                        })
                                        .on("click", function(d) {
                                            d3.select(this.parentNode).remove();
                                        });
                                }
                            });
                var _menuSize = _menu[0][0].offsetWidth;
                var _menuClose = d3.select('.canvas').append('img')
                    .attr('class', 'textmenu menuclose')
                    .style("left", (loc[0]+25 + _menuSize - SMALL_ICON_SIZE/2) + "px")
                    .style("top", (loc[1]+20 - SMALL_ICON_SIZE/2) + "px")
                    .attr('src', 'static/closebutton_small.png')
                    .on("mouseover", function(d) {
                        d3.select(this).style('cursor', 'pointer');
                    })
                    .on("mouseout", function(d) {
                        d3.select(this).style('cursor', 'default');
                    })
                    .on("click", function(d) {
                        d3.select('.textmenu[nodeindex="'+i_node+'"]').remove();
                        d3.select(this).remove();
                    });
                });
            }
        });

    var charge = -6500;
    force = d3.layout.force()
        .gravity(.2)
        .friction(0.9)
        .charge(charge)
        .size([w*1.2, h])
        .links(graph.links)
        .nodes(graph.supernodes)
        .start();

    force.on("tick", function(e) {
        var kx = 8.2 * e.alpha;
        var ky = 0.2 * e.alpha;
        force.charge(charge);
        graph.supernodes.forEach(function(d, i) {
            d.x += (d.truex - d.x) * kx;
            d.y += (d.truey - d.y) * ky;


        });
    });

    for (var i=0; i<10000; i++) { force.tick(); }

    force.stop();
    link.each(function(d) {
        var xStart = d.source.truex;
        var yStart = d.source.y;
        var xEnd = d.target.truex;
        var yEnd = d.target.y;

        var dx = xEnd - xStart;
        var dy = yEnd - yStart;
        var theta = Math.atan(dy/dx);
        d.x1 = xStart + d.source.radius * Math.cos(theta);
        d.x2 = xEnd - d.target.radius * Math.cos(theta);
        d.y1 = yStart + d.source.radius * Math.sin(theta);
        d.y2 = yEnd - d.target.radius * Math.sin(theta);
    });
    link.attr("y1", function(d) { return d.x1; })
        .attr("x1", function(d) { return d.y1; })
        .attr("y2", function(d) { return d.x2; })
        .attr("x2", function(d) { return d.y2; });
    supernode_g
        .attr("transform", function(d) {
            //return "translate(" + d.truex + "," + d.y + ")";
            return "translate(" + d.y + "," + d.truex + ")";
        });

    moveSubnodesToSupernodes();
    //pollNodeStatuses(); // keep polling forever
});
