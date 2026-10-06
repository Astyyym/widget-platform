using WpfShell.Core;

namespace WpfShell.Core.Tests;

[TestClass]
public sealed class DockGeometryTests
{
    private static readonly DockRect LeftMonitor = new(-1920, 0, 1920, 1040);

    [TestMethod]
    public void TopAndBottomUseRequestedEdgeAndRatio()
    {
        var top = DockGeometry.Compute(LeftMonitor, new DockSize(400, 200), DockEdge.Top, 0.5);
        var bottom = DockGeometry.Compute(LeftMonitor, new DockSize(400, 200), DockEdge.Bottom, 0.5);
        Assert.AreEqual(-1160d, top.X, 0.001);
        Assert.AreEqual(0d, top.Y, 0.001);
        Assert.AreEqual(-1160d, bottom.X, 0.001);
        Assert.AreEqual(840d, bottom.Y, 0.001);
    }

    [TestMethod]
    public void SideEdgesPlaceAtRatioEndpointsOnNegativeOrigin()
    {
        var leftStart = DockGeometry.Compute(LeftMonitor, new DockSize(400, 200), DockEdge.Left, 0);
        var leftEnd = DockGeometry.Compute(LeftMonitor, new DockSize(400, 200), DockEdge.Left, 1);
        var right = DockGeometry.Compute(LeftMonitor, new DockSize(400, 200), DockEdge.Right, 0.5);
        Assert.AreEqual(new DockPosition(-1920, 0, 400, 200), leftStart);
        Assert.AreEqual(new DockPosition(-1920, 840, 400, 200), leftEnd);
        Assert.AreEqual(-400d, right.X, 0.001);
    }

    [TestMethod]
    public void OversizedWindowClampsToWorkArea()
    {
        var result = DockGeometry.Compute(new DockRect(-80, 30, 300, 160),
            new DockSize(500, 400), DockEdge.Bottom, 1);
        Assert.AreEqual(new DockPosition(-80, 30, 300, 160), result);
    }

    [TestMethod]
    public void PhysicalWorkAreaConvertsUsingDpiScale()
    {
        var result = DockGeometry.ToDips(new DockRect(-2560, 0, 2560, 1528), 1.5, 1.5);
        Assert.AreEqual(-1706.6666666667, result.X, 0.001);
        Assert.AreEqual(1018.6666666667, result.Height, 0.001);
    }

    [TestMethod]
    public void RejectsInvalidScaleAndRatio()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => DockGeometry.ToDips(LeftMonitor, 0, 1));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            DockGeometry.Compute(LeftMonitor, new DockSize(400, 200), DockEdge.Top, double.NaN));
    }
}
