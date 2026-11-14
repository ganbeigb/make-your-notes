package com.dshwork.coursenotes;

/**
 * Starts the embedded Node.js runtime (nodejs-mobile) that runs the local server inside the app.
 *
 * `libnode.so` exports the C++ entry point `node::Start`; the JNI glue in jni/node_bridge.cpp calls it.
 * `startNode` blocks until the event loop ends, so it must run on a thread of its own.
 */
public final class NodeRunner {
    static {
        System.loadLibrary("node");           // nodejs-mobile runtime (libnode.so)
        System.loadLibrary("coursenotes_node"); // this app's JNI glue
    }

    private NodeRunner() {}

    /** Mirrors Node's stdout/stderr into `path` (pass null to disable). Call before {@link #startNode}. */
    public static native void setLogFile(String path);

    /** Runs Node with the given argv. Blocks. Returns the process exit code. */
    public static native int startNode(String[] args);
}
