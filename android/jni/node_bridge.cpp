// node_bridge.cpp - minimal JNI glue that starts the embedded Node.js runtime.
//
// nodejs-mobile ships libnode.so, which exports `node::Start(int, char**)` (no JNI bridge of its own).
// node::Start never returns until the event loop stops, so Java calls it on a dedicated thread.

#include <jni.h>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <unistd.h>
#include <pthread.h>
#include <android/log.h>

#include "node.h"

#define LOG_TAG "CourseNotesNode"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

// ---- stdout / stderr -> logcat (and a file the UI can show) ----------------------------------------------------

static int g_out[2];
static int g_err[2];
static char g_log_path[512] = {0};
static pthread_mutex_t g_log_mx = PTHREAD_MUTEX_INITIALIZER;

static void log_to_file(const char* line) {
  if (!g_log_path[0]) return;
  pthread_mutex_lock(&g_log_mx);
  FILE* f = fopen(g_log_path, "a");
  if (f) { fputs(line, f); fputc('\n', f); fclose(f); }
  pthread_mutex_unlock(&g_log_mx);
}

static void* pump_out(void*) {
  char buf[2048];
  ssize_t n;
  while ((n = read(g_out[0], buf, sizeof buf - 1)) > 0) {
    if (buf[n - 1] == '\n') --n;
    buf[n] = 0;
    __android_log_write(ANDROID_LOG_INFO, LOG_TAG, buf);
    log_to_file(buf);
  }
  return nullptr;
}

static void* pump_err(void*) {
  char buf[2048];
  ssize_t n;
  while ((n = read(g_err[0], buf, sizeof buf - 1)) > 0) {
    if (buf[n - 1] == '\n') --n;
    buf[n] = 0;
    __android_log_write(ANDROID_LOG_ERROR, LOG_TAG, buf);
    log_to_file(buf);
  }
  return nullptr;
}

static void redirect_stdio() {
  setvbuf(stdout, nullptr, _IONBF, 0);
  if (pipe(g_out) == 0) {
    dup2(g_out[1], STDOUT_FILENO);
    pthread_t t;
    if (pthread_create(&t, nullptr, pump_out, nullptr) == 0) pthread_detach(t);
  }
  setvbuf(stderr, nullptr, _IONBF, 0);
  if (pipe(g_err) == 0) {
    dup2(g_err[1], STDERR_FILENO);
    pthread_t t;
    if (pthread_create(&t, nullptr, pump_err, nullptr) == 0) pthread_detach(t);
  }
}

// ---- JNI entry points ------------------------------------------------------------------------------------------

extern "C" JNIEXPORT void JNICALL
Java_com_dshwork_coursenotes_NodeRunner_setLogFile(JNIEnv* env, jclass, jstring path) {
  const char* c = path ? env->GetStringUTFChars(path, nullptr) : nullptr;
  g_log_path[0] = 0;
  if (c) {
    strncpy(g_log_path, c, sizeof(g_log_path) - 1);
    g_log_path[sizeof(g_log_path) - 1] = 0;
    env->ReleaseStringUTFChars(path, c);
  }
}

extern "C" JNIEXPORT jint JNICALL
Java_com_dshwork_coursenotes_NodeRunner_startNode(JNIEnv* env, jclass, jobjectArray args) {
  const jsize argc = env->GetArrayLength(args);
  if (argc <= 0) { LOGE("startNode: no arguments"); return 1; }

  int size = 0;
  for (jsize i = 0; i < argc; i++) {
    jstring s = (jstring) env->GetObjectArrayElement(args, i);
    const char* c = env->GetStringUTFChars(s, nullptr);
    size += (int) strlen(c) + 1;
    env->ReleaseStringUTFChars(s, c);
    env->DeleteLocalRef(s);
  }
  char* buf = (char*) calloc(size, sizeof(char));
  char** argv = (char**) calloc(argc + 1, sizeof(char*));
  char* at = buf;
  for (jsize i = 0; i < argc; i++) {
    jstring s = (jstring) env->GetObjectArrayElement(args, i);
    const char* c = env->GetStringUTFChars(s, nullptr);
    strcpy(at, c);
    argv[i] = at;
    at += strlen(c) + 1;
    env->ReleaseStringUTFChars(s, c);
    env->DeleteLocalRef(s);
  }

  LOGI("starting node: %s", argv[1] ? argv[1] : "(no script)");
  redirect_stdio();
  const int code = node::Start((int) argc, argv);
  LOGI("node exited with code %d", code);
  return (jint) code;
}
