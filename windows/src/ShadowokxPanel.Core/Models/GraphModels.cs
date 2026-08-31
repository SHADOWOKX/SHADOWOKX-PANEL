namespace ShadowokxPanel.Core.Models;

public readonly record struct GraphPoint(
    DateOnly Date,
    long Tokens,
    double X,
    double Y,
    double Position);
