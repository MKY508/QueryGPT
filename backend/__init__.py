"""
QueryGPT Backend Package
A natural language to SQL conversion system with multi-language support
"""

__version__ = "1.0.0"
__author__ = "QueryGPT Team"
__license__ = "MIT"

# Version information
VERSION_INFO = {
    "major": 1,
    "minor": 0,
    "patch": 0,
    "release": "stable",
    "build_date": "2025-08-22"
}

def get_version():
    """Get the current version string"""
    return __version__

def get_version_info():
    """Get detailed version information"""
    return VERSION_INFO