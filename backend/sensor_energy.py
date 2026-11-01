"""Timestamp window clipping shared by the AC settings energy estimator."""

def selected_spans(begin, finish, lower, upper, clocks=(None, None)):
    """Actual elapsed spans clipped to the same UTC+08 date/time filters as logs."""
    begin, finish = max(begin, lower), min(finish, upper)
    if finish <= begin:
        return []
    if not any(clocks):
        return [(begin, finish)]
    def seconds(value, default):
        return int(value[:2]) * 3600 + int(value[3:]) * 60 if value else default
    first, last = seconds(clocks[0], 0), min(86400, seconds(clocks[1], 86340) + 60)
    windows = [(first, last)] if first < last else [(first, 86400), (0, last)]
    result = []
    for day in range(int((begin + 28800) // 86400), int((finish + 28800) // 86400) + 1):
        for start, stop in windows:
            a, b = max(begin, day * 86400 - 28800 + start), min(finish, day * 86400 - 28800 + stop)
            if b > a:
                result.append((a, b))
    return result
