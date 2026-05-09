from flask import Flask

app = Flask(__name__)


@app.route("/")
def home():
    return {"status": "success", "message": "Flask server is running via uv!"}


if __name__ == "__main__":
    # We use 0.0.0.0 to make it accessible on your local network
    app.run(host="0.0.0.0", port=5000, debug=True)
