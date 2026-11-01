"""Keep legacy desktop APIs local and mutations behind the administrator bridge."""
import hmac
from ipaddress import ip_address
from urllib.parse import urlsplit
from flask import jsonify, request

LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1'}
READ_ONLY_POSTS = {'/api/predict-energy', '/api/predict-recorded-energy'}


def register_local_access(app, token):
    @app.before_request
    def desktop_boundary():
        if not request.path.startswith('/api/') or request.path.startswith('/api/monitoring/'):
            return None
        try:
            local = ip_address(request.remote_addr or '0.0.0.0').is_loopback
        except ValueError:
            local = False
        origin = request.headers.get('Origin')
        trusted_origin = not origin or origin == 'null' or (
            urlsplit(origin).scheme in {'http', 'https'} and urlsplit(origin).hostname in LOCAL_HOSTS)
        if not local or urlsplit('//' + request.host).hostname not in LOCAL_HOSTS or not trusted_origin:
            return jsonify(error='This API is available only through the local desktop.'), 403
        if origin == 'null' or (request.method not in {'GET', 'HEAD', 'OPTIONS'} and request.path not in READ_ONLY_POSTS):
            expected = token()
            if not expected or not hmac.compare_digest(request.headers.get('Authorization', ''), 'Bearer ' + expected):
                return jsonify(error='Administrator authorization is required.'), 401
        return None
