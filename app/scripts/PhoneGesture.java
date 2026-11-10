import android.os.SystemClock;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.MotionEvent;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.Method;

/** One touchscreen gesture, with coordinates read from stdin. */
public final class PhoneGesture {
    private static Object manager;
    private static Method inject;

    private static void send(int action, long down, float x, float y) throws Exception {
        MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0);
        event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        try {
            if (!((Boolean) inject.invoke(manager, event, 2))) throw new Exception("injection failed");
        } finally {
            event.recycle();
        }
    }

    public static void main(String[] args) {
        boolean downSent = false;
        long down = 0;
        float x = 0, y = 0;
        try {
            if (args.length != 0) throw new Exception("unexpected arguments");
            BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
            String countLine = reader.readLine();
            int count = Integer.parseInt(countLine);
            if (count < 2 || count > 100) throw new Exception("invalid count");
            float[][] points = new float[count][2];
            for (int i = 0; i < count; i++) {
                String line = reader.readLine();
                if (line == null || !line.matches("[0-9]{1,5} [0-9]{1,5}")) throw new Exception("invalid point");
                String[] parts = line.split(" ");
                points[i][0] = Integer.parseInt(parts[0]);
                points[i][1] = Integer.parseInt(parts[1]);
            }
            if (reader.readLine() != null) throw new Exception("extra input");
            Class<?> cls;
            try { cls = Class.forName("android.hardware.input.InputManagerGlobal"); }
            catch (ClassNotFoundException e) { cls = Class.forName("android.hardware.input.InputManager"); }
            manager = cls.getMethod("getInstance").invoke(null);
            inject = cls.getMethod("injectInputEvent", InputEvent.class, int.class);
            x = points[0][0]; y = points[0][1];
            down = SystemClock.uptimeMillis();
            // Attempt cleanup even if injection throws after the system receives DOWN.
            downSent = true;
            send(MotionEvent.ACTION_DOWN, down, x, y);
            for (int i = 1; i < count; i++) {
                float startX = x, startY = y;
                int steps = Math.max(1, (int) Math.ceil(Math.hypot(points[i][0] - x, points[i][1] - y) / 12.0));
                steps = Math.min(steps, 100);
                for (int step = 1; step <= steps; step++) {
                    SystemClock.sleep(16);
                    x = startX + (points[i][0] - startX) * step / steps;
                    y = startY + (points[i][1] - startY) * step / steps;
                    send(MotionEvent.ACTION_MOVE, down, x, y);
                }
            }
            send(MotionEvent.ACTION_UP, down, x, y);
            downSent = false;
            System.out.println("success");
        } catch (Throwable e) {
            if (downSent) {
                try { send(MotionEvent.ACTION_UP, down, x, y); } catch (Throwable ignored) { }
            }
            System.err.println("gesture failed");
            System.exit(1);
        }
    }
}
