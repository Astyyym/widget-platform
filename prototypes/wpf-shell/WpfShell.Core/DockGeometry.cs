namespace WpfShell.Core;

public enum DockEdge { Top, Right, Bottom, Left }

public readonly record struct DockRect(double X, double Y, double Width, double Height);
public readonly record struct DockSize(double Width, double Height);
public readonly record struct DockPosition(double X, double Y, double Width, double Height);

public static class DockGeometry
{
    public static DockRect ToDips(DockRect physical, double scaleX, double scaleY)
    {
        if (!double.IsFinite(scaleX) || !double.IsFinite(scaleY) || scaleX <= 0 || scaleY <= 0)
            throw new ArgumentOutOfRangeException(nameof(scaleX), "DPI scale must be positive and finite.");

        return new DockRect(physical.X / scaleX, physical.Y / scaleY,
            physical.Width / scaleX, physical.Height / scaleY);
    }

    public static DockPosition Compute(DockRect workArea, DockSize requestedSize, DockEdge edge, double ratio)
    {
        if (!double.IsFinite(workArea.X) || !double.IsFinite(workArea.Y) ||
            !double.IsFinite(workArea.Width) || !double.IsFinite(workArea.Height) ||
            workArea.Width <= 0 || workArea.Height <= 0)
            throw new ArgumentOutOfRangeException(nameof(workArea));
        if (!double.IsFinite(requestedSize.Width) || !double.IsFinite(requestedSize.Height) ||
            requestedSize.Width <= 0 || requestedSize.Height <= 0)
            throw new ArgumentOutOfRangeException(nameof(requestedSize));
        if (!double.IsFinite(ratio)) throw new ArgumentOutOfRangeException(nameof(ratio));
        if (!Enum.IsDefined(edge)) throw new ArgumentOutOfRangeException(nameof(edge));

        var width = Math.Min(requestedSize.Width, workArea.Width);
        var height = Math.Min(requestedSize.Height, workArea.Height);
        var fraction = Math.Clamp(ratio, 0d, 1d);
        var travelX = workArea.Width - width;
        var travelY = workArea.Height - height;
        var x = edge switch
        {
            DockEdge.Left => workArea.X,
            DockEdge.Right => workArea.X + travelX,
            _ => workArea.X + travelX * fraction
        };
        var y = edge switch
        {
            DockEdge.Top => workArea.Y,
            DockEdge.Bottom => workArea.Y + travelY,
            _ => workArea.Y + travelY * fraction
        };
        return new DockPosition(x, y, width, height);
    }
}
