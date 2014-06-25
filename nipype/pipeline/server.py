"""
A server for visualizing and interacting with nipype pipelines.
Use with `server.serve_content(workflow)`

Limitations:
    - Does not support workflows with map nodes or join nodes
"""
from __future__ import print_function

import collections
from copy import deepcopy
import json
import mimetypes
import os
import os.path as op
import shutil
import time

import networkx as nx
import cherrypy

from .utils import generate_expanded_graph

from ..utils.filemanip import loadpkl

this_file_location = os.path.dirname(__file__)

def serve_content(workflow=None):
    """
    Starts a cherrypy webserver that can display the results of a completed
    workflow. Meant to be used with the output of self.run()

    Parameters
    ----------
    workflow: a nipype.engine.Workflow object to illustrate graphically
    execgraph: result of calling the workflow's run() method
    """

    server = WorkflowServer(workflow)
    content_dir = op.join(workflow.base_dir, 'server_content')
    try:
        os.unlink(content_dir)
    except:
        try:
            shutil.rmtree(content_dir)
        except:
            pass
    os.mkdir(content_dir)

    shutil.copytree(op.join(this_file_location, 'viz'), op.join(content_dir, 'viz'))

    IP = "0.0.0.0"
    PORT = 64222
    global_config = {'server.socket_port': PORT,
                    'server.socket_host': IP,
                    }
    cherrypy.config.update(global_config)
    appconfig = {
            '/viewer': {
                'tools.auth_basic.on': True,
                 'tools.auth_basic.realm': 'viz',
                 'tools.auth_basic.checkpassword': checkpasshash,
            },
            '/static': {
                'tools.staticdir.on' : True,
                'tools.staticdir.dir' : os.path.join(content_dir, 'viz'),
                'tools.staticdir.debug': True,
            }
    }
    cherrypy.quickstart(server, config=appconfig)

class WorkflowServer(object):
    """
    Server that displays the result of a workflow

    Displays the results from a workflow using a convenient
    web-based interface. Currently supports iterables, but not
    map nodes or join nodes.
    """

    def __init__(self, workflow):
        """
        Parameters
        ----------

        workflow: a nipype.engine.Workflow object
            the workflow to show info/results for
        """
        self.workflow = workflow
        # TODO display workflow in a hierarchy here: use nested workflows, etc
        #graph = workflow._graph
        graph = workflow._create_flat_graph()
        # _create_flat_graph expands sub-workflows, but not iterables.
        # generate_expanded_graph goes all the way down to iterable expansion

        # iterable-expanded graph
        self.execgraph = generate_expanded_graph(deepcopy(graph))

        self.expanded_nodes = nx.topological_sort(self.execgraph)
        unexpanded_nodes_unstaged = nx.topological_sort(graph)
        self.unexpanded_nodes = []
        json_dict = {'unodes': [], 'enodes': [], 'links': [],
                'reverse_mapping': {}, 'klasses': []}


        ### Go through nodes and group them into "stages", where each "stage"
        ### has nodes whose descendants are all in future stages
        # TODO do this separately for each connected component
        # (access conn. comp. w/"groups" from utils.topological_sort)
        current_stage_nodes = []
        all_stages = []
        completed_nodes = set()
        for (i, node) in enumerate(unexpanded_nodes_unstaged):
            if graph.out_degree(node) == 0:
                current_stage_nodes.append(node)
        while True:
            prev_stage_nodes = []
            for node in current_stage_nodes:
                completed_nodes.add(node)
                for parent in graph.predecessors(node):
                    if parent not in completed_nodes:
                        # make sure all its other children have been accounted
                        # for before adding it
                        other_children = graph.successors(parent)
                        if set(other_children).issubset(completed_nodes):
                            prev_stage_nodes.append(parent)
            all_stages.append(current_stage_nodes)
            if prev_stage_nodes == []:
                break
            current_stage_nodes = prev_stage_nodes
        all_stages.reverse()

        unode_counter = 0
        iterable_mapping = collections.defaultdict(lambda: [])
        for node in self.expanded_nodes + unexpanded_nodes_unstaged:
            klass = get_clean_class_name(node)
            if klass not in json_dict['klasses']:
                json_dict['klasses'].append(klass)


        ### Find correspondences between non-expanded nodes and expanded nodes
        for i, stage in enumerate(all_stages):
            for j, unode in enumerate(sorted(stage)):
                # TODO do something smarter here: I'm sure this correspondence is
                # established somewhere already
                # TODO handle map nodes, join nodes
                # TODO be more efficient
                for (k, enode) in enumerate(self.expanded_nodes):
                    #if unode.name == enode.name:
                    #if enode._id.startswith(unode._id):
                    #if get_full_name(enode).startswith(get_full_name(unode)):
                    ename = get_full_name(enode)
                    uname = get_full_name(unode)
                    if uname == ename[:len(uname)]:
                        iterable_mapping[unode_counter].append(k)
                        assert k not in json_dict['reverse_mapping']
                        json_dict['reverse_mapping'][k] = unode_counter
                iterable_mapping[unode_counter].sort(key=lambda n: self.expanded_nodes[n]._id)
                ### Save pertinent info about unexpanded nodes
                klass = get_clean_class_name(unode)
                json_dict['unodes'].append(dict(name=unode._id,
                                                id='unode' + str(unode_counter),
                                                klass=json_dict['klasses'].index(klass),
                                                index=unode_counter,
                                                stage=i,
                                                height=j,
                                                fullname='.'.join(ename),
                                                _id=unode._id,
                                                enodes=iterable_mapping[unode_counter],
                                                ))
                self.unexpanded_nodes.append(unode)
                unode_counter += 1

        ### Prepare JSON data

        for k, enode in enumerate(self.expanded_nodes):
            # TODO figure out why these are in /tmp and fix the split() hack
            # this takes /tmp/blah/<workflow name>/... and returns
            # <workflow name>/...
            out_dir = enode.output_dir()
            if not out_dir.startswith(workflow.base_dir):
                out_dir = op.join(workflow.base_dir,
                                  enode.output_dir().split(os.path.sep, 3)[-1])
            report_file = op.join(out_dir, '_report', 'report.rst')
            result_file = op.join(out_dir, "result_%s.pklz" % enode.name)
            klass = get_clean_class_name(enode)
            json_dict['enodes'].append(dict(name=enode._id,
                                            _id=enode._id,
                                            klass=json_dict['klasses'].index(klass),
                                            id='subnode' + str(k),
                                            index=k,
                                            unode=json_dict['reverse_mapping'][k],
                                            parameterization=enode.parameterization,
                                            report=report_file,
                                            result=result_file,
                                            ))

        for (u, v) in graph.in_edges_iter():
            json_dict['links'].append(dict(supersource=self.unexpanded_nodes.index(u),
                                           supertarget=self.unexpanded_nodes.index(v),
                                           weight=1,
                                           ))

        self.json_dict = json_dict
        self.nodes_by_id = {}
        for enode in self.expanded_nodes:
            self.nodes_by_id[enode._id] = enode

        json_string = json.dumps(json_dict, indent=4)
        json_string = json_string.replace('unode', 'supernode').replace('enode', 'subnode')
        with open('/tmp/pipe.json', 'w') as f:
            f.write(json_string)


    def convert_to_old_naming(self, json_dict):
        str = json.dumps(json_dict).replace('unode', 'supernode').replace('enode', 'subnode')
        return json.loads(str)
    @cherrypy.expose
    def index(self, **kwargs):
        index="""
<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-type" content="text/html; charset=utf-8">
    <title>Pipeline visualization</title>
    <script type="text/javascript" src="https://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min.js"></script>
    <script src="http://d3js.org/d3.v3.min.js"></script>
    <script src="static/pipeviz.js"></script>
    <link type="text/css" rel="stylesheet" href="static/style.css">
    <link href="//maxcdn.bootstrapcdn.com/font-awesome/4.1.0/css/font-awesome.min.css" rel="stylesheet">
    </style>
  </head>
  <body>
  <div class="canvas"></div>
  </body>
</html>
        """
        return index

    @cherrypy.expose
    def getGraphJSON(self):
        cherrypy.response.headers['Content-Type'] = 'application/json'
        return json.dumps(self.convert_to_old_naming(self.json_dict))

    @cherrypy.expose
    def nodeStatuses(self):
        time.sleep(10)
        statuses = []
        for node in self.expanded_nodes:
            if node.result.runtime.returncode == 0:
                statuses.append(1)
            else:
                statuses.append(-1)
        cherrypy.response.headers['Content-Type'] = 'application/json'
        return json.dumps(self.convert_to_old_naming(statuses))

    @cherrypy.expose
    def getOutputInfo(self, index):
        index = int(index)
        result = loadpkl(self.json_dict['enodes'][index]['result'])
        out = []
        stuff_to_show = ['stdout', 'stderr', 'cmdline', 'returncode']
        runtime = result.runtime
        if True:
            pass
        for thing in stuff_to_show:
            try:
                value = runtime.__getattribute__(thing)
                json.dumps(value)
                out.append({'name': thing, 'value': value, 'type': 'string'})
            except (AttributeError, ValueError):
                pass

        # TODO find a better way to get the outputs here
        for (outname, output) in result.outputs.get().items():
            if type(output) is str:
                out.append({'name': outname, 'value': output, 'type': 'file'})
        cherrypy.response.headers['Content-Type'] = 'application/json'
        print(out)
        return json.dumps(out)

    @cherrypy.expose
    def retrieveFile(self, filename):
        """
        Meant for reading of files from disk.
        """
        # TODO make this secure: currently allows reading of arbitrary
        # files once you've authenticated with the password. integrate w/dataset?
        if filename.startswith(self.workflow.base_dir) and os.path.exists(filename):
            # mime type enables us to read the file after loading
            (_, type) = mimetypes.guess_type(filename)
            cherrypy.response.headers["Access-Control-Allow-Origin"] = '*'
            cherrypy.response.headers["Content-Type"] = "application/" + type
            return open(filename, 'r')
        else:
            print("Warning: invalid file access attempted")
            return ''

# TODO more secure password checking (salting? reading from file? etc)
def checkpasshash(realm, user, password):
    import hashlib
    return user == 'pipeline' and hashlib.sha1(password).hexdigest() == '992b5d666718483c9676361ebc685d122089e3eb'

def get_full_name(node):
    # fullname looks like "topworkflow.subworkflow.nodename" and _id looks
    # like "nodename.a1.a2"; returns [topworkflow,subworkflow,nodename,a1,a2]
    prefix = node.fullname.split('.')
    suffix = node._id.split('.')
    assert prefix[-1] == suffix[0]
    return prefix[:-1] + suffix

def get_clean_class_name(node):
    klassname = repr(node.interface.__class__).split("'")[1]
    if klassname.startswith('nipype.interfaces'):
        klassname = klassname.split('.', 2)[-1]
    return klassname
